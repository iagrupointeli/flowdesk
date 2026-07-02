import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { setupInterceptors } from './lib/setupInterceptors'
import { useAuthStore }      from './stores/authStore'

// ── Lazy: carregados só quando necessário ──────────────────────────────────
// Evita que o bundle inicial carregue código de rotas que o usuário pode
// nunca acessar (ex.: admin) e melhora o Time-to-Interactive do Login.
import { lazy, Suspense } from 'react'
const Login          = lazy(() => import('./pages/Login'))
const Register       = lazy(() => import('./pages/Register'))
const FirstAccess    = lazy(() => import('./pages/FirstAccess'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))
const AppLayout      = lazy(() => import('./components/layout/AppLayout'))
const Board          = lazy(() => import('./pages/Board'))
const NewDemand      = lazy(() => import('./pages/NewDemand'))
const DemandDetail   = lazy(() => import('./pages/DemandDetail'))
const Dashboard      = lazy(() => import('./pages/Dashboard'))
const Comercial      = lazy(() => import('./pages/Comercial'))
const Profile        = lazy(() => import('./pages/Profile'))
const Search         = lazy(() => import('./pages/Search'))
const AdminUsers          = lazy(() => import('./pages/admin/AdminUsers'))
const AdminDepartments    = lazy(() => import('./pages/admin/AdminDepartments'))
const AdminTags           = lazy(() => import('./pages/admin/AdminTags'))
const AdminWorkflows      = lazy(() => import('./pages/admin/AdminWorkflows'))
const AdminFieldBuilder   = lazy(() => import('./pages/admin/AdminFieldBuilder'))
const AdminWebhooks       = lazy(() => import('./pages/admin/AdminWebhooks'))
const AdminAudit          = lazy(() => import('./pages/admin/AdminAudit'))
const AdminRecurring      = lazy(() => import('./pages/admin/AdminRecurring'))
const AdminAssets         = lazy(() => import('./pages/admin/AdminAssets'))
const AdminCampaigns      = lazy(() => import('./pages/admin/AdminCampaigns'))
const AdminPortfolios     = lazy(() => import('./pages/admin/AdminPortfolios'))
const AdminOccupancy      = lazy(() => import('./pages/admin/AdminOccupancy'))
const AdminAssetsMap      = lazy(() => import('./pages/admin/AdminAssetsMap'))
const ChatLayout          = lazy(() => import('./pages/chat/ChatLayout'))
const FocusMode           = lazy(() => import('./pages/FocusMode'))
const TvMode              = lazy(() => import('./pages/TvMode'))
const Areas               = lazy(() => import('./pages/Areas'))
const Projects            = lazy(() => import('./pages/Projects'))
const ProjectDetail       = lazy(() => import('./pages/ProjectDetail'))
const ExternalPortal      = lazy(() => import('./pages/ExternalPortal'))
const IntakeForm          = lazy(() => import('./pages/IntakeForm'))
import ProtectedRoute from './components/ProtectedRoute'

// ── Interceptores Axios ────────────────────────────────────────────────────
// DEVE ser executado em nível de módulo (fora do componente).
// App.jsx é o único lugar onde authStore e api.js são ambos resolvidos
// sem criar dependência circular no grafo ESM.
setupInterceptors(useAuthStore.getState)

// ── Telas de loading ───────────────────────────────────────────────────────
function FullPageSpinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
    </div>
  )
}

// ── Componente raiz ────────────────────────────────────────────────────────
export default function App() {
  const isHydrating = useAuthStore(s => s.isHydrating)

  useEffect(() => {
    // Chama a action via getState() para não criar uma subscrição desnecessária.
    // A re-renderização quando isHydrating muda é gerenciada pela seleção acima.
    useAuthStore.getState().hydrate()
  }, [])

  // ── Barreira de hidratação ─────────────────────────────────────────────
  // Enquanto não sabemos se o usuário está logado, nenhuma rota é renderizada.
  // Sem isso: o Router mostraria /login por 1 frame antes de ir para /board
  // (flash de rota errada, perceptível especialmente em refresh com F5).
  if (isHydrating) return <FullPageSpinner />

  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          {/* ── Rotas públicas ──────────────────────────────────────────── */}
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/first-access"    element={<FirstAccess />} />
          <Route path="/change-password" element={<ChangePassword />} />

          {/* Portal do prestador externo — público, segurança via token */}
          <Route path="/external/:token" element={<ExternalPortal />} />

          {/* Formulário de intake — público, segurança via token opaco */}
          <Route path="/intake/:token" element={<IntakeForm />} />

          {/* ── Área protegida (autenticação obrigatória) ───────────────── */}
          <Route element={<ProtectedRoute />}>
            {/* Modo TV — fullscreen, FORA do AppLayout (sem sidebar/header) */}
            <Route element={<ProtectedRoute roles={['super_admin', 'dept_admin']} />}>
              <Route path="/tv" element={<TvMode />} />
            </Route>

            <Route element={<AppLayout />}>
              {/* Rota raiz → board */}
              <Route index element={<Navigate to="/board" replace />} />

              {/* Kanban */}
              <Route path="/board/:demandTypeId" element={<Board />} />
              <Route path="/board"              element={<Board />} />

              {/* Criação de demanda — /demands/new ANTES de /:demandId */}
              <Route path="/demands/new"          element={<NewDemand />} />

              {/* Detalhes da demanda */}
              <Route path="/demands/:demandId"    element={<DemandDetail />} />

              {/* Dashboard de métricas (apenas admins) */}
              <Route path="/dashboard"            element={<Dashboard />} />
              <Route path="/comercial"            element={<Comercial />} />

              {/* Perfil do usuário */}
              <Route path="/profile"              element={<Profile />} />

              {/* Busca global */}
              <Route path="/search"               element={<Search />} />

              {/* Chat interno */}
              <Route path="/chat"                 element={<ChatLayout />} />

              {/* Modo Foco */}
              <Route path="/foco"                 element={<FocusMode />} />

              {/* Tarefas pessoais (legacy) */}

              {/* Projetos pessoais */}
              <Route path="/areas"         element={<Areas />} />
              <Route path="/projects"     element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />

              {/* Área admin — acesso restrito a super_admin e dept_admin */}
              <Route element={<ProtectedRoute roles={['super_admin', 'dept_admin']} />}>
                <Route path="/admin/users"                    element={<AdminUsers />} />
                <Route path="/admin/departments"              element={<AdminDepartments />} />
                <Route path="/admin/tags"                     element={<AdminTags />} />
                <Route path="/admin/workflows"                element={<AdminWorkflows />} />
                <Route path="/admin/workflows/:id/fields"     element={<AdminFieldBuilder />} />
                <Route path="/admin/webhooks"                 element={<AdminWebhooks />} />
                <Route path="/admin/audit"                   element={<AdminAudit />} />
                <Route path="/admin/recurring"               element={<AdminRecurring />} />
                <Route path="/admin/assets"                  element={<AdminAssets />} />
                <Route path="/admin/campaigns"               element={<AdminCampaigns />} />
                <Route path="/admin/portfolios"              element={<AdminPortfolios />} />
                <Route path="/admin/occupancy"               element={<AdminOccupancy />} />
              </Route>

              {/* Análise/estratégico — apenas super_admin */}
              <Route element={<ProtectedRoute roles={['super_admin']} />}>
                <Route path="/admin/map"                     element={<AdminAssetsMap />} />
              </Route>
            </Route>
          </Route>

          {/* ── Fallback ────────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
