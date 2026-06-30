import { z } from 'zod'

/**
 * Gera um z.object() a partir dos campos ativos de um tipo de demanda.
 *
 * Chamado sincronamente no momento da montagem de DemandFormContent,
 * garantindo que o schema seja estável durante toda a vida do formulário.
 *
 * Mapeamento field_type → Zod:
 *   text / textarea  → z.string()            (vazio = '' para optional)
 *   number           → z.preprocess → z.number() ('' vira undefined antes da validação)
 *   date             → z.string()            (ISO date 'YYYY-MM-DD')
 *   select           → z.string() + refine   (deve ser um dos option.id)
 *   cpf              → z.string() + refine   (11 dígitos após strip)
 *
 * @param {Array<{ id: string, label: string, field_type: string, required: boolean, options?: any[] }>} fields
 * @returns {import('zod').ZodObject<any>}
 */
export function buildDemandSchema(fields) {
  const payloadShape = {}

  for (const f of fields) {
    if (f.archived_at) {
      // Campo arquivado: NÃO exibido nem cobrado no formulário de criação.
      // MAS precisa ser mapeado no schema como passthrough para não rejeitar
      // payloads históricos que contenham valores para este campo — caso o
      // admin arquive um campo depois que demandas já foram criadas com ele.
      // z.unknown().optional() aceita qualquer valor (ou ausência) sem validar.
      payloadShape[f.id] = z.unknown().optional()
      continue
    }

    let fieldSchema

    switch (f.field_type) {

      case 'text':
      case 'textarea':
        fieldSchema = f.required
          ? z.string().min(1, `${f.label} é obrigatório.`)
          : z.string().optional()
        break

      case 'number':
        // z.preprocess converte '' / undefined / null → undefined antes da validação,
        // evitando que Zod tente coagir '' para NaN.
        fieldSchema = z.preprocess(
          v => (v === '' || v === null || v === undefined) ? undefined : Number(v),
          f.required
            ? z.number({
                required_error:    `${f.label} é obrigatório.`,
                invalid_type_error: `${f.label} deve ser um número.`,
              })
            : z.number({ invalid_type_error: `${f.label} deve ser um número.` }).optional()
        )
        break

      case 'date':
        fieldSchema = f.required
          ? z.string().min(1, `${f.label} é obrigatório.`)
          : z.string().optional()
        break

      case 'select': {
        const validIds = (f.options ?? []).map(o => String(o.id))
        fieldSchema = f.required
          ? z
              .string()
              .min(1, `${f.label} é obrigatório.`)
              .refine(v => validIds.includes(v), `${f.label}: opção inválida.`)
          : z.string().optional()
        break
      }

      case 'cpf': {
        const digitCount = (v) => (v ?? '').replace(/\D/g, '').length === 11
        fieldSchema = f.required
          ? z
              .string()
              .min(1, `${f.label} é obrigatório.`)
              .refine(digitCount, `${f.label} deve ter 11 dígitos.`)
          : z
              .string()
              .optional()
              .refine(v => !v || digitCount(v), `${f.label} deve ter 11 dígitos.`)
        break
      }

      default:
        // Campo desconhecido: aceita qualquer valor sem validação
        fieldSchema = z.unknown().optional()
    }

    payloadShape[f.id] = fieldSchema
  }

  return z.object({
    title:       z.string().min(3, 'Título deve ter no mínimo 3 caracteres.').max(500),
    description: z.string().min(1, 'Descrição é obrigatória.'),
    payload:     z.object(payloadShape),
  })
}

/**
 * Gera os defaultValues para react-hook-form a partir dos campos.
 * Todos os campos dinâmicos iniciam como string vazia (inputs controlados).
 *
 * @param {Array} fields
 * @returns {{ title: string, description: string, payload: Record<string, string> }}
 */
export function buildDefaultValues(fields) {
  const payload = {}
  for (const f of fields) {
    if (!f.archived_at) payload[f.id] = ''
  }
  return { title: '', description: '', payload }
}

/**
 * Limpa e transforma o payload do formulário antes de enviar ao backend.
 *
 *   - Campos vazios ('' / undefined / null) são omitidos.
 *   - CPF: envia apenas os 11 dígitos (sem máscara).
 *   - number: converte para Number.
 *
 * @param {Record<string, any>} rawPayload - dados do formulário (f.id → valor)
 * @param {Array} fields
 * @returns {Record<string, any>}
 */
export function buildPayload(rawPayload, fields) {
  const clean = {}

  for (const f of fields) {
    if (f.archived_at) continue

    const val = rawPayload?.[f.id]
    if (val === '' || val === undefined || val === null) continue

    switch (f.field_type) {
      case 'cpf':
        clean[f.id] = String(val).replace(/\D/g, '')
        break
      case 'number':
        clean[f.id] = Number(val)
        break
      default:
        clean[f.id] = val
    }
  }

  return clean
}
