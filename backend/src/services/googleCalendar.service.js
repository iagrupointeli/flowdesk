// ─── Google Calendar Service ─────────────────────────────────────────────────
//
// Serviço modular de integração com Google Calendar.
// Portável entre Fase 1 (site externo de agendas) e Fase 2 (InteliONE nativo).
//
// Autenticação suportada:
//   Service Account (recomendado para server-to-server):
//     GOOGLE_SERVICE_ACCOUNT_KEY_JSON = '{"type":"service_account",...}'
//   OAuth2 (para acesso delegado a usuário):
//     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//
// Calendário padrão:
//   GOOGLE_CALENDAR_ID = 'primary' ou o ID do calendário da sala
//
// Dep: npm install googleapis

import { google } from 'googleapis'
import { query }  from '#config/database.js'
import { logger } from '#lib/logger.js'

// ── Autenticação ─────────────────────────────────────────────────────────────

function buildAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })
  }

  // Fallback: OAuth2 com refresh token de longa duração
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/api/auth/google/callback',
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

// ── Mapeamento booking → Google Calendar Event ───────────────────────────────
//
// extendedProperties.private preserva o vínculo de volta ao InteliONE:
// quando um evento chega via webhook do Google, encontramos o booking local
// pelo intelioneBookingId sem depender do external_event_id na query.

function toGoogleEvent(booking) {
  return {
    summary:     booking.title,
    description: [
      booking.description ?? '',
      booking.room_name ? `Sala: ${booking.room_name}` : '',
    ].filter(Boolean).join('\n'),
    location: booking.room_location ?? booking.room_name ?? '',
    start: { dateTime: new Date(booking.starts_at).toISOString(), timeZone: 'America/Sao_Paulo' },
    end:   { dateTime: new Date(booking.ends_at).toISOString(),   timeZone: 'America/Sao_Paulo' },
    attendees: (booking.attendees ?? []).map(a =>
      typeof a === 'string' ? { email: a } : { email: a.email, displayName: a.name ?? '' }
    ),
    // colorId do Google Calendar: 1=azul(LED), 3=roxo(Studio), 2=verde(Tática)
    colorId: booking.room_color_id ?? '1',
    extendedProperties: {
      private: {
        intelioneBookingId: String(booking.id),
        roomId:             String(booking.room_id),
      },
    },
    // Permite que o InteliONE seja identificado como organizador do evento
    source: {
      title: 'InteliONE',
      url:   process.env.FRONTEND_URL ?? 'http://localhost:5174',
    },
  }
}

// ── Classe principal ─────────────────────────────────────────────────────────

export class GoogleCalendarService {
  /**
   * @param {string} [calendarId] - Google Calendar ID da sala.
   *   Se omitido, usa GOOGLE_CALENDAR_ID do .env.
   */
  constructor(calendarId) {
    this.calendarId = calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? 'primary'
    this._auth      = buildAuth()
  }

  get _cal() {
    return google.calendar({ version: 'v3', auth: this._auth })
  }

  // ── Operações CRUD ───────────────────────────────────────────────────────

  /** Cria evento → retorna Google Calendar event ID */
  async createEvent(booking) {
    const res = await this._cal.events.insert({
      calendarId:  this.calendarId,
      requestBody: toGoogleEvent(booking),
    })
    logger.info({ externalEventId: res.data.id, bookingId: booking.id }, 'GCal: evento criado')
    return res.data.id
  }

  /** Atualiza evento existente (full replace) */
  async updateEvent(externalEventId, booking) {
    await this._cal.events.update({
      calendarId:  this.calendarId,
      eventId:     externalEventId,
      requestBody: toGoogleEvent(booking),
    })
    logger.info({ externalEventId, bookingId: booking.id }, 'GCal: evento atualizado')
  }

  /**
   * Remove evento.
   * Ignora 410 Gone: evento já apagado diretamente no Google Calendar — sem erro.
   */
  async deleteEvent(externalEventId) {
    await this._cal.events
      .delete({ calendarId: this.calendarId, eventId: externalEventId })
      .catch(err => {
        if (err.code === 410) {
          logger.warn({ externalEventId }, 'GCal: evento já removido (410 Gone)')
          return
        }
        throw err
      })
    logger.info({ externalEventId }, 'GCal: evento removido')
  }

  // ── Sync incremental (pull) ───────────────────────────────────────────────

  /**
   * Busca mudanças no calendário desde o último sync.
   * @param {string|null} syncToken - Token do sync anterior (null = full sync inicial)
   * @returns {{ events: object[], nextSyncToken: string }}
   *
   * Uso:
   *   const { events, nextSyncToken } = await svc.pullChanges(room.sync_token)
   *   // Salvar nextSyncToken para o próximo ciclo
   *   // Para cada event.status === 'cancelled': cancelar reserva local
   *   // Para cada event criado/atualizado: upsert reserva local
   */
  async pullChanges(syncToken = null) {
    const params = {
      calendarId:   this.calendarId,
      maxResults:   250,
      singleEvents: true,
      orderBy:      'startTime',
    }

    if (syncToken) {
      params.syncToken = syncToken
    } else {
      // Full sync: eventos dos próximos 90 dias
      params.timeMin = new Date().toISOString()
      params.timeMax = new Date(Date.now() + 90 * 86_400_000).toISOString()
    }

    const events        = []
    let   nextSyncToken = null
    let   pageToken     = null

    do {
      if (pageToken) params.pageToken = pageToken
      const res   = await this._cal.events.list(params)
      events.push(...(res.data.items ?? []))
      pageToken     = res.data.nextPageToken ?? null
      nextSyncToken = res.data.nextSyncToken ?? nextSyncToken
    } while (pageToken)

    logger.debug({ calendarId: this.calendarId, count: events.length }, 'GCal: pull concluído')
    return { events, nextSyncToken }
  }

  // ── Geração do URL de autorização OAuth2 (Fase de setup) ─────────────────

  /**
   * Retorna a URL para o admin autorizar o acesso ao Google Calendar.
   * Usar apenas no fluxo de setup inicial (OAuth2, não Service Account).
   */
  getAuthUrl() {
    if (!(this._auth instanceof google.auth.OAuth2)) {
      throw new Error('getAuthUrl só está disponível no modo OAuth2, não Service Account.')
    }
    return this._auth.generateAuthUrl({
      access_type: 'offline',
      scope:       ['https://www.googleapis.com/auth/calendar'],
      prompt:      'consent',
    })
  }

  /**
   * Troca o code do callback OAuth2 pelo refresh_token.
   * Salvar o refresh_token no .env como GOOGLE_REFRESH_TOKEN.
   */
  async exchangeCode(code) {
    if (!(this._auth instanceof google.auth.OAuth2)) {
      throw new Error('exchangeCode só está disponível no modo OAuth2.')
    }
    const { tokens } = await this._auth.getToken(code)
    logger.info({ hasRefreshToken: !!tokens.refresh_token }, 'GCal: código OAuth2 trocado')
    return tokens
  }
}

// ── Funções de alto nível (usadas pelos controllers de room_bookings) ─────────
// Encapsulam sync + persistência do estado no banco.
// São fire-and-log: falhas não bloqueiam a resposta ao usuário.

/**
 * Após confirmar uma reserva: envia ao Google Calendar e persiste o external_event_id.
 * @param {object} booking - Registro completo de room_bookings (com room_name, room_location)
 */
export async function syncBookingToGoogle(booking) {
  try {
    const calendarId = booking.external_calendar_id
      ?? booking.room_google_calendar_id
      ?? process.env.GOOGLE_CALENDAR_ID

    const svc   = new GoogleCalendarService(calendarId)
    const extId = await svc.createEvent(booking)

    await query(
      `UPDATE room_bookings
       SET external_event_id    = $1,
           external_calendar_id = $2,
           last_synced_at       = NOW(),
           sync_status          = 'synced',
           sync_error           = NULL,
           updated_at           = NOW()
       WHERE id = $3`,
      [extId, calendarId, booking.id]
    )
    return extId
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'GCal: falha ao sincronizar reserva')
    await query(
      `UPDATE room_bookings
       SET sync_status = 'failed',
           sync_error  = $1,
           updated_at  = NOW()
       WHERE id = $2`,
      [err.message?.slice(0, 500), booking.id]
    ).catch(() => {})
    // Não propaga: a reserva existe no InteliONE, o sync pode ser retentado
  }
}

/**
 * Após cancelar uma reserva: remove do Google Calendar.
 */
export async function cancelBookingOnGoogle(booking) {
  if (!booking.external_event_id) return
  try {
    const svc = new GoogleCalendarService(booking.external_calendar_id)
    await svc.deleteEvent(booking.external_event_id)
    await query(
      `UPDATE room_bookings
       SET sync_status    = 'synced',
           last_synced_at = NOW(),
           updated_at     = NOW()
       WHERE id = $1`,
      [booking.id]
    )
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'GCal: falha ao cancelar evento')
  }
}

/**
 * Job de retry: reprocessa reservas com sync_status = 'failed'.
 * Chamar via cron ou endpoint de admin.
 */
export async function retryFailedSyncs() {
  const { rows } = await query(
    `SELECT rb.*, r.name AS room_name, r.location AS room_location,
            r.google_calendar_id AS room_google_calendar_id
     FROM room_bookings rb
     JOIN rooms r ON r.id = rb.room_id
     WHERE rb.sync_status = 'failed'
       AND rb.status = 'confirmed'
       AND rb.anonymized_at IS NULL
     ORDER BY rb.created_at
     LIMIT 50`
  )

  logger.info({ count: rows.length }, 'GCal: iniciando retry de syncs falhados')
  for (const booking of rows) {
    await syncBookingToGoogle(booking)
  }
}
