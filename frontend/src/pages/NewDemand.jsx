import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { useNewDemandStore }                    from '../stores/newDemandStore'
import { buildDemandSchema, buildDefaultValues,
         buildPayload }                          from '../lib/buildDemandSchema'
import DynamicField                              from '../components/demands/DynamicField'
import FileDropzone                              from '../components/demands/FileDropzone'
import api                                       from '../lib/api'

/**
 * Página de criação de demanda: /demands/new?type=<demandTypeId>
 *
 * ── Máquina de estados do submit ────────────────────────────────────────────
 *
 *   'idle'         → formulário em branco, pronto para preencher
 *   'creating'     → POST /demands em andamento
 *   'uploading'    → upload serial de anexos em andamento
 *   'upload_failed'→ demanda criada, mas ≥1 anexo falhou
 *                    → user pode tentar reenviar só os que falharam ou pular
 *   (navigate)     → tudo certo, vai para o board
 *
 * ── Erros 422 de campo (hotfix confirmado) ──────────────────────────────────
 *
 *   Service (fieldErrors keyed by UUID):
 *     setError(`payload.${fieldId}`, { message })
 *     → aparece em DynamicField via errors.payload?.[field.id]  ✓
 *
 *   Controller Zod (fieldErrors keyed by 'title'/'description'):
 *     setError('title', { message })  /  setError('description', { message })
 *
 * ── Upload two-step (regra inegociável) ─────────────────────────────────────
 *
 *   Etapa 1: POST /api/demands (application/json) → retorna { id }
 *   Etapa 2: loop serial POST /api/demands/:id/attachments (multipart, 1/req)
 *
 *   Falha na etapa 2: NÃO redireciona. Trava no estado 'upload_failed',
 *   exibe quais arquivos falharam e permite retentar SÓ esses.
 */
export default function NewDemand() {
  const [searchParams] = useSearchParams()
  const typeId = searchParams.get('type')
  const navigate = useNavigate()

  const typeDetail = useNewDemandStore(s => s.typeDetail)
  const isLoading  = useNewDemandStore(s => s.isLoading)
  const error      = useNewDemandStore(s => s.error)

  useEffect(() => {
    if (!typeId) return
    useNewDemandStore.getState().fetchTypeDetail(typeId)
    return () => useNewDemandStore.getState().reset()
  }, [typeId])

  if (!typeId) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 py-16 text-gray-500">
          <p className="text-sm">Nenhum tipo de demanda especificado.</p>
          <button onClick={() => navigate(-1)} className="text-sm text-primary-600 underline">Voltar</button>
        </div>
      </PageShell>
    )
  }

  if (isLoading) return <PageShell><FormSkeleton /></PageShell>

  if (error) {
    return (
      <PageShell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-700">Erro ao carregar o formulário</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button
            onClick={() => useNewDemandStore.getState().fetchTypeDetail(typeId)}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Tentar novamente
          </button>
        </div>
      </PageShell>
    )
  }

  if (!typeDetail) return null

  return (
    <PageShell title={`Nova demanda — ${typeDetail.name}`} subtitle={typeDetail.department_name}>
      <DemandFormContent
        key={typeDetail.id}
        typeDetail={typeDetail}
        typeId={typeId}
        navigate={navigate}
      />
    </PageShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DemandFormContent
// ─────────────────────────────────────────────────────────────────────────────

function DemandFormContent({ typeDetail, typeId, navigate }) {
  const fields        = (typeDetail.fields ?? []).filter(f => !f.archived_at)
  const schema        = buildDemandSchema(fields)
  const defaultValues = buildDefaultValues(fields)

  const {
    register, handleSubmit, control, setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues })

  const [files,          setFiles]          = useState([])
  const [globalError,    setGlobalError]    = useState(null)
  const [phase,          setPhase]          = useState('idle')
  const [assets,         setAssets]         = useState([])
  const [assetId,        setAssetId]        = useState('')
  // phase: 'idle' | 'creating' | 'uploading' | 'upload_failed'
  const [uploadProgress, setUploadProgress] = useState(null)  // { done, total }
  const [createdDemand,  setCreatedDemand]  = useState(null)  // { id } após etapa 1
  const [failedFiles,    setFailedFiles]    = useState([])    // File[] que falharam

  // ── Carrega pontos OOH para o select (opcional) ───────────────────────────
  useEffect(() => {
    const ctrl = new AbortController()
    api.get('/assets', { signal: ctrl.signal })
      .then(res => setAssets(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})   // sem pontos cadastrados → select simplesmente não aparece
    return () => ctrl.abort()
  }, [])

  // ── Função pura de upload serial ───────────────────────────────────────────
  // Retorna os arquivos que falharam (pode ser []).
  // NÃO navega — quem chama decide o que fazer com o resultado.
  async function runUploads(demandId, filesToUpload) {
    const failed = []
    for (let i = 0; i < filesToUpload.length; i++) {
      setUploadProgress({ done: i, total: filesToUpload.length })
      const fd = new FormData()
      fd.append('file', filesToUpload[i])
      try {
        await api.post(`/demands/${demandId}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } catch (err) {
        console.warn('[NewDemand] falha no upload:', filesToUpload[i].name, err)
        failed.push(filesToUpload[i])
      }
    }
    return failed
  }

  // ── Submit principal ────────────────────────────────────────────────────────
  async function onSubmit(data) {
    setGlobalError(null)
    setPhase('creating')

    // ── Etapa 1: POST /api/demands (JSON puro) ────────────────────────────
    let demand
    try {
      const { data: created } = await api.post('/demands', {
        title:          data.title,
        description:    data.description,
        demand_type_id: typeId,
        payload:        buildPayload(data.payload, fields),
        asset_id:       assetId || null,
      })
      demand = created
      setCreatedDemand(demand)
    } catch (err) {
      setPhase('idle')
      const resp = err?.response

      if (resp?.status === 422) {
        // ── Erros de campo do service (keyed by UUID) ─────────────────────
        // setError(`payload.${fieldId}`) → aparece em errors.payload?.[field.id]
        const svcErrors = resp.data?.fieldErrors
        if (svcErrors) {
          for (const [fieldId, msg] of Object.entries(svcErrors)) {
            setError(`payload.${fieldId}`, { message: msg })
          }
          return
        }
        // ── Erros Zod do controller (keyed por 'title', 'description'…) ──
        const zodErrors = resp.data?.errors?.fieldErrors
        if (zodErrors) {
          for (const [name, msgs] of Object.entries(zodErrors)) {
            setError(name, { message: Array.isArray(msgs) ? msgs[0] : msgs })
          }
          return
        }
      }

      setGlobalError(resp?.data?.error ?? 'Erro ao criar a demanda. Tente novamente.')
      return
    }

    // ── Etapa 2: upload serial (só se há arquivos) ────────────────────────
    if (files.length === 0) {
      navigate(`/board/${typeId}`)
      return
    }

    setPhase('uploading')
    const failed = await runUploads(demand.id, files)

    if (failed.length === 0) {
      navigate(`/board/${typeId}`)
    } else {
      // Trava no estado upload_failed — sem redirecionamento automático
      setFailedFiles(failed)
      setPhase('upload_failed')
      setUploadProgress(null)
      setGlobalError(
        `${failed.length} de ${files.length} anexo(s) não puderam ser enviados. ` +
        `A demanda foi criada. Reenvie apenas os que falharam ou pule para o quadro.`
      )
    }
  }

  // ── Retry: tenta apenas os arquivos que falharam ───────────────────────────
  async function handleRetryUploads() {
    if (!createdDemand) return
    setGlobalError(null)
    setPhase('uploading')
    const retryList = [...failedFiles]
    setFailedFiles([])

    const stillFailed = await runUploads(createdDemand.id, retryList)

    if (stillFailed.length === 0) {
      navigate(`/board/${typeId}`)
    } else {
      setFailedFiles(stillFailed)
      setPhase('upload_failed')
      setUploadProgress(null)
      setGlobalError(
        `${stillFailed.length} arquivo(s) ainda falhou(aram). ` +
        `Verifique sua conexão e tente novamente, ou pule para o quadro.`
      )
    }
  }

  // ── Flags derivadas ────────────────────────────────────────────────────────
  const isBusy            = isSubmitting || phase === 'creating' || phase === 'uploading'
  const isUploadFailed    = phase === 'upload_failed'
  const showForm          = !isUploadFailed           // esconde form após falha de upload
  const pendingFilesCount = isUploadFailed ? failedFiles.length : files.length

  return (
    <div className="space-y-6">

      {/* ── Erro global ───────────────────────────────────────────────────── */}
      {globalError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="flex-shrink-0 mt-0.5">⚠</span>
          <span className="flex-1">{globalError}</span>
          {!isBusy && (
            <button type="button" onClick={() => setGlobalError(null)}
              className="flex-shrink-0 text-red-400 hover:text-red-600" aria-label="Fechar">✕</button>
          )}
        </div>
      )}

      {/* ── Estado: upload falhou — painel de retry ───────────────────────── */}
      {isUploadFailed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="font-medium text-amber-800">Demanda criada com sucesso</p>
              <p className="text-sm text-amber-700 mt-0.5">
                {failedFiles.length} anexo(s) não puderam ser enviados:
              </p>
              <ul className="mt-2 space-y-1">
                {failedFiles.map(f => (
                  <li key={f.name + f.size} className="text-xs text-amber-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    {f.name} <span className="text-amber-500">({formatBytes(f.size)})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleRetryUploads}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2
                         text-sm font-semibold text-white hover:bg-amber-700
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isBusy ? <Spinner /> : null}
              Tentar reenviar ({failedFiles.length} arquivo{failedFiles.length > 1 ? 's' : ''})
            </button>
            <button
              type="button"
              onClick={() => navigate(`/board/${typeId}`)}
              disabled={isBusy}
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium
                         text-amber-700 hover:bg-amber-100 disabled:opacity-60"
            >
              Ir para o quadro mesmo assim
            </button>
          </div>
        </div>
      )}

      {/* ── Formulário principal (oculto após upload_failed) ─────────────── */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">

          {/* Campos fixos */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-700">Informações gerais</legend>

            <div>
              <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
                Título <span className="text-red-500">*</span>
              </label>
              <input
                id="title" type="text"
                placeholder="Descreva brevemente a demanda"
                className={inputCls(!!errors.title)}
                {...register('title')}
              />
              {errors.title && <FieldError msg={errors.title.message} />}
            </div>

            <div>
              <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
                Descrição <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description" rows={4}
                placeholder="Detalhe o contexto e as necessidades desta demanda"
                className={`${inputCls(!!errors.description)} resize-y`}
                {...register('description')}
              />
              {errors.description && <FieldError msg={errors.description.message} />}
            </div>

            {/* Ponto OOH — opcional, só aparece se há pontos cadastrados */}
            {assets.length > 0 && (
              <div>
                <label htmlFor="asset" className="mb-1 block text-sm font-medium text-gray-700">
                  Ponto vinculado <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <select
                  id="asset"
                  value={assetId}
                  onChange={e => setAssetId(e.target.value)}
                  className={inputCls(false)}
                >
                  <option value="">Nenhum — demanda sem ponto físico</option>
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code ? `[${a.code}] ` : ''}{a.name}{a.city ? ` — ${a.city}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {/* Campos dinâmicos */}
          {fields.length > 0 && (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-gray-700">
                Campos específicos — {typeDetail.name}
              </legend>
              {fields.map(field => (
                <DynamicField
                  key={field.id}
                  field={field}
                  register={register}
                  control={control}
                  error={errors.payload?.[field.id]}
                />
              ))}
            </fieldset>
          )}

          {/* Dropzone */}
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-gray-700">Anexos (opcional)</legend>
            <FileDropzone files={files} onChange={setFiles} />
          </fieldset>

          {/* Barra de ações */}
          <div className="flex items-center justify-between border-t border-gray-200 pt-4">
            <ProgressLabel phase={phase} progress={uploadProgress} />
            <div className="flex gap-3">
              <button type="button" onClick={() => navigate(-1)} disabled={isBusy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                           text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                Cancelar
              </button>
              <button type="submit" disabled={isBusy}
                className="flex min-w-[155px] items-center justify-center gap-2 rounded-lg
                           bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                           hover:bg-primary-700 disabled:opacity-70 disabled:cursor-not-allowed
                           focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1">
                {isBusy
                  ? <Spinner />
                  : <span>Criar{pendingFilesCount > 0 ? ` + ${pendingFilesCount} anexo(s)` : ''}</span>
                }
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function PageShell({ title, subtitle, children }) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <button onClick={() => navigate(-1)}
          className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd" />
          </svg>
          Voltar
        </button>
        {title && <>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </>}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
    </div>
  )
}

function FieldError({ msg }) {
  return <p className="mt-1 text-xs text-red-500">{msg}</p>
}

function ProgressLabel({ phase, progress }) {
  if (phase === 'creating') return <span className="text-sm text-primary-600 animate-pulse">Criando demanda…</span>
  if (phase === 'uploading' && progress) {
    return (
      <span className="text-sm text-primary-600 animate-pulse">
        Enviando anexos ({progress.done + 1}/{progress.total})…
      </span>
    )
  }
  return <span />
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function FormSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2].map(i => (
        <div key={i}><div className="mb-1.5 h-4 w-24 rounded bg-gray-200" /><div className="h-9 rounded-lg bg-gray-100" /></div>
      ))}
      {[1, 2, 3].map(i => (
        <div key={i + 10}><div className="mb-1.5 h-4 w-32 rounded bg-gray-200" /><div className="h-9 rounded-lg bg-gray-100" /></div>
      ))}
      <div className="h-28 rounded-xl bg-gray-100" />
    </div>
  )
}

function inputCls(hasError) {
  return [
    'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400',
    hasError ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-gray-300 bg-white hover:border-gray-400',
  ].join(' ')
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
