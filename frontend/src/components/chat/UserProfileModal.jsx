import { useEffect, useState } from 'react'
import api from '../../lib/api'

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  dept_admin:  'Administrador',
  user:        'Usuário',
}

/**
 * Modal de perfil público (somente leitura) — aberto ao clicar no nome de
 * alguém no cabeçalho do chat.
 *
 * Avatar hoje é só a inicial do nome; `avatar_url` já vem do backend como
 * campo pronto pra quando existir upload de foto de perfil (feature futura).
 */
export default function UserProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setProfile(null)
    setError(null)
    api.get(`/users/${userId}`, { signal: ctrl.signal })
      .then(r => setProfile(r.data))
      .catch(err => { if (err?.code !== 'ERR_CANCELED') setError('Erro ao carregar perfil.') })
    return () => ctrl.abort()
  }, [userId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {!profile && !error && (
          <div className="flex justify-center py-8">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" />
          </div>
        )}

        {profile && (
          <>
            <div className="flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center overflow-hidden
                               rounded-full bg-primary-100 text-2xl font-semibold text-primary-700">
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                  : profile.name?.[0]?.toUpperCase()
                }
              </span>
              <h2 className="mt-3 text-base font-semibold text-gray-900">{profile.name}</h2>
              <p className="text-sm text-gray-500">{profile.email}</p>
              <span className="mt-2 inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
            </div>

            {profile.departments?.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                  Departamentos
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.departments.map(d => (
                    <span
                      key={d.id}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium
                        ${d.is_primary ? 'bg-primary-50 text-primary-700' : 'bg-gray-50 text-gray-600'}`}
                    >
                      {d.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={onClose}
              className="mt-5 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                         text-gray-700 hover:bg-gray-50"
            >
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
