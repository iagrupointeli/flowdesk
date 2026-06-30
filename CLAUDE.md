# FlowDesk — instruções do projeto

## PM2 Services

| Port | Name | Type |
|------|------|------|
| 5432 | postgres (Docker) | DB |
| 3001 | flowdesk-3001 | Express backend |
| 5174 | flowdesk-5174 | Vite frontend |

**Subir tudo:**
```bash
# 1. DB (Docker) — na raiz do projeto
docker compose up -d

# 2. Backend + Frontend
pm2 start ecosystem.config.cjs
```


App de gestão de demandas/workflow. Stack: React 18 + Vite + TailwindCSS + Zustand +
React Router v6 + Axios · Node 20 + Express + PostgreSQL 16 + Zod · MinIO (anexos) ·
busboy (multipart). Aliases: `#config/*`, `#services/*`, `#controllers/*`, `#utils/*`.

## Invariantes Arquiteturais (sempre ativos — não precisa eu repetir)

1. **Zero N+1** — nada de query dentro de loop; use JOIN ou batch.
2. **Mutação otimista** no frontend — atualiza a UI na hora, reverte em erro.
3. **AbortController** em todo `useEffect` que faz fetch — cleanup aborta in-flight.
4. **RBAC validado no backend** — nunca confie em gate só de frontend.
5. **Proteção SSRF** (anti-DNS-rebinding: resolve o IP uma vez + `servername` para SNI)
   em toda requisição de saída.

## SQL — Gotchas conhecidos

- **`npm run migrate` falha com PgBouncer ativo**: PgBouncer (porta 6432) tem incompatibilidade
  de auth com PostgreSQL 16 (scram-sha-256) ao criar novas conexões de pool. Para rodar migrations,
  usar sempre via `docker exec`:
  ```powershell
  docker cp backend\src\migrations\sql\047_foo.sql flowdesk_postgres:/tmp/047_foo.sql
  docker exec flowdesk_postgres psql -U flowdesk_user -d flowdesk -f /tmp/047_foo.sql
  docker exec flowdesk_postgres psql -U flowdesk_user -d flowdesk -c "INSERT INTO schema_migrations (filename) VALUES ('047_foo.sql');"
  ```
  O app (PM2) conecta normalmente pelo PgBouncer — apenas o script de migration é afetado.

- **Índice parcial com `CURRENT_DATE`**: PostgreSQL rejeita `CREATE INDEX … WHERE col >= CURRENT_DATE`
  com "functions in index predicate must be marked IMMUTABLE" (`CURRENT_DATE` é `STABLE`).
  Fix: remover o predicado e usar índice simples.
- **`listDemands` retorna array direto** (não `{demands:[]}`). Ao consumir no frontend,
  usar `Array.isArray(data) ? data : (data.demands ?? [])` como guard.
- **`GET /assets` é paginado mas mantém o body como array puro**: `page` + `page_size`
  (máx. 500) na query; o total completo do filtro vai no header **`X-Total-Count`**
  (service retorna `{rows,total}` via `COUNT(*) OVER()`). Não envolva o body num objeto —
  o select de pontos do `NewDemand` consome o array direto. `AdminAssets.jsx` lê o header
  p/ montar o pager (~32 páginas em SC). Ordenação estável: `ORDER BY a.name, a.id`.
- **Variável de loop em DO block aninhado**: dentro de um `FOR r IN … LOOP` não é possível
  reusar `r` num segundo `FOR r IN … LOOP` interno — o PostgreSQL confunde o escopo.
  Fix: usar nome diferente no loop interno (ex: `r2`).

- **Migration DO block não migra tarefas com `project = NULL`**: o DO block de 037_projects.sql
  filtra `WHERE project IS NOT NULL AND project_id IS NULL`. Tarefas criadas sem nome de projeto
  ficam com `project_id = NULL` e não aparecem em nenhum projeto. Fix manual:
  `UPDATE personal_tasks SET project_id = '<uuid>', project = '<nome>' WHERE project_id IS NULL AND archived_at IS NULL`.

## Frontend — Gotchas conhecidos

- **Rename não sincroniza estado derivado**: ao renomear uma seção via `PATCH`, apenas `setSections` não
  basta — o estado derivado que depende do `name` como chave (ex: `localTasks[].section`, `colMap[name]`)
  deve ser atualizado no mesmo `.then()`. Caso contrário os items "somem" até o próximo reload.
  Fix: `setLocalTasks(prev => prev.map(t => t.section === oldName ? {...t, section: newName} : t))`

- **Padrão inline-edit (duplo clique)**: estado `editing` + `editTitle` + `useRef` para focus automático
  via `useEffect([editing])`. `commit()` on blur/Enter; Esc cancela e restaura o valor original.
  Em cards dnd-kit, todo `onPointerDown` do input precisa de `e.stopPropagation()` para não iniciar drag.

- **Zustand persist + seletor reativo**: ao ler estado de um store, NUNCA selecione um método
  (ex: `useStore(s => s.shortcuts)` que retorna função) — a referência é estável e o componente
  não re-renderiza. Selecione o dado direto: `useShortcutStore(s => s.byUser[userId] ?? [])`.
  Esse foi o bug do "clique não contabiliza" na ShortcutBar.

- **Barra de atalhos (ShortcutBar)**: `components/shortcuts/ShortcutBar.jsx` + `stores/shortcutStore.js`
  (persist `flowdesk-shortcuts`, por usuário). Fica `fixed left-0 top-14 w-56 z-10` — **abaixo** da
  Sidebar (`z-30`), então aparece quando a sidebar recolhe e some quando ela abre por cima. Montada
  em `AppLayout.jsx` antes da `<Sidebar>`. Atalhos: Páginas fixas + Quadros + Projetos.

- **Layout da Sidebar**: `main` é fixo em `ml-56` (não anima); só o `Header` acompanha a sidebar
  (`ml-56`/`ml-0` com transição). Sidebar é `position: fixed`. Ao desafixar (pin off), um
  `useEffect([pinned])` força `setIsOpen(false)` imediatamente — evita o "2 cliques para recolher".

## Auth — Gotchas conhecidos

- **JWT não inclui `name` do usuário**: o middleware `authenticate` injeta apenas
  `{ id, role, deptIds, primaryDeptId }`. Quando um service precisar do nome do usuário
  (ex: mensagem de notificação), buscar via query: `SELECT name FROM users WHERE id = $1`.

## Negócio OOH — Calendário de Bi-semanas

O mercado OOH usa períodos de **14 dias corridos** chamados "bi-semanas" para planejar e faturar campanhas.
O Grupo Inteli usa o calendário **Puracor 2026** como referência:

- **BS 02** começa em 29/12/2025 (primeira bi-semana do ciclo 2026)
- Numeração **par**: BS 02, 04, 06 … 52 (26 bi-semanas por ano)
- Cada bi-semana = 14 dias exatos; 26 × 14 = 364 dias/ano
- Outros anos: deslocar 364 dias por ano em relação à referência 2026

Implementado em `AdminOccupancy.jsx` como `bisemanaRanges(year)` — constante `BS_REF_START = '2025-12-29'`.

## Pilar 1 — Ingestão Dataprisma (scripts/dataprisma-import/)

**Script:** `scripts/dataprisma-import/migrate-assets.js` (streaming, idempotente)
**Fonte:** MySQL 51.79.21.221:3306 · `peoutdoor_site_dataprisma` · user `peoutdoor_ruan` (SELECT-only)
**Destino:** PostgreSQL 16 localhost:**5432** · tabela `assets` (migrations 024/035/043)

> **Status:** SC importado e validado (15.582 pontos, 0 falhas). Benchmark de busca
> `Blumenau/SC` = **0,198 ms** via `idx_assets_city_state`. Nacional pendente.

### Schema da origem (descoberto via --discover, 2026-06)
- **`out785_pontos`** (tabela viva, 169.929) — `backup_pontos_2025` é snapshot 2025 (152k).
  PK composta `(id, area)`.
- `area` → UF **ou** região comercial (`SP`,`SC`,…,`NORDESTE`,`DFGOIAS`). É a chave do `--state` e do DEPT_MAP.
- `titulo` → nome do ponto (→ `name`). `codigoUnico` → código único (→ `code`).
- `cidade` (int) → FK p/ **`out785_pontos_cidades`** (`.cidade` = nome, `.sigla` = UF real).
- `tipo` (int) → FK p/ **`out785_pontos_tipos`** com chave composta `(id, area)` → classificado em asset_type/structure_type por `classify()`.
- `complemento` é ambíguo: ora dimensão (`9,00 x 3,00m`), ora referência (`Terminal Urbano`).
  O script **extrai** só a dimensão; referência/iluminação/geo vão para `notes`.
- Fotos: `imagem` é só o arquivo → URL real `https://scoutdoor.com.br/imagem/<UF>/pontos/<arquivo>` (PHOTO_BASE_URL).

Os lookups (cidades + tipos, ~6k linhas) são pré-carregados em Maps → **zero query por linha**.

### Sequência de execução
```powershell
cd scripts\dataprisma-import
cp .env.example .env        # preencha SRC_PASS, DST_PASS, DEPT_MAP
npm install                 # mysql2 + pg

node migrate-assets.js --discover                              # inspeciona a origem
node migrate-assets.js --state SC --limit 1000 --dry-run --sample 3   # valida mapeamento
node migrate-assets.js --state SC --limit 1000                # POC gravação real
node migrate-assets.js --state SC                             # estado completo
node migrate-assets.js                                        # nacional
```

### Flags
| Flag | Descrição |
|---|---|
| `--discover` | Schema + amostra + distribuição por `area` e sai |
| `--state SC` | Filtra por `area` (UF ou região) |
| `--limit N` | Limita a N registros (POC) |
| `--dry-run` | Lê/mapeia sem gravar (não exige destino) |
| `--sample N` | No dry-run, imprime N registros mapeados |
| `--table <nome>` | Tabela de origem (padrão: `out785_pontos`) |
| `--offset N` | Retoma a partir do offset N |

### Invariantes
- `ON CONFLICT (external_code='<AREA>-<id>')` → upsert idempotente (rodável N vezes).
- Colisão no índice único de `code` → fallback automático para `code = external_code` (não perde ponto).
- `source = 'dataprisma'` → tag de origem para rastrear/reprocessar.
- `department_id` vem do DEPT_MAP por `area`; ausente = NULL (ativo da holding).
- Conexão direto na **5432** (PgBouncer/6432 quebra novas conexões — ver gotcha SQL).

### Ajuste pós-import (atribuição de marcas em lote)
```sql
UPDATE assets SET department_id = '<uuid-da-marca>'
WHERE state = 'BA' AND source = 'dataprisma' AND department_id IS NULL;
```

## Roadmap de Módulos

| Migration | Módulo | Status | Notas |
|---|---|---|---|
| 001–042 | Core (demandas, workflow, assets, campanhas, projetos) | ✅ Operacional | Base do InteliONE |
| 043 | Asset Governance (department_id, external_code, Dataprisma) | ✅ Aplicada | **SC importado: 15.582 pontos** (Pilar 1) |
| 044 | LGPD Compliance (consentimento, anonimização, lgpd_requests) | ✅ Aplicada | RMD-ready |
| 045 | Performance (GIN indexes, geo indexes) | ✅ Aplicada | Busca `Blumenau/SC` ~1ms via geo index |
| 046 | Verticalization AI (maintenance_rules, service_orders, checking_queue) | ✅ Aplicada | Loop Inteli Estruturas → MovePro |
| **047** | **Recursos de Matriz / Agenda de Salas** | ✅ **Aplicada** (via `docker exec`) | LED, Studio, Tática + Google Calendar sync |
| 048 | calendar_sync_state (sync_token por calendário) | Planejada | Necessária para múltiplos calendários com pull incremental |

> **Migrations 043–047 já estão no banco.** A 047 foi aplicada via `docker exec` (não `npm run migrate`,
> que falha com o PgBouncer ativo — ver gotcha SQL). Próxima nova migration: registrar em
> `schema_migrations` após aplicar pelo mesmo método.

### Módulo 047 — Recursos de Matriz / Agenda

**Objetivo:** Centralizar a reserva das salas do Grupo Inteli (LED, Studio, Tática) no InteliONE com sincronização bidirecional com o Google Calendar.

**Tabelas:** `rooms` · `room_bookings`

**Anti-double-booking:** EXCLUDE via `tstzrange + btree_gist` (mesmo padrão de `campaigns`).

**Google Calendar Sync:**
- Serviço: `backend/src/services/googleCalendar.service.js`
- Fase 1 (site externo): `syncBookingToGoogle()` / `cancelBookingOnGoogle()` / `retryFailedSyncs()`
- Fase 2 (InteliONE nativo): mesmo serviço, controllers a implementar em `src/controllers/rooms.controller.js`
- Auth: Service Account preferível (`.env`: `GOOGLE_SERVICE_ACCOUNT_KEY_JSON`)
- Dep: `npm install googleapis` (ainda não instalada)

**ENV necessárias para ativar o sync:**
```
GOOGLE_SERVICE_ACCOUNT_KEY_JSON='{"type":"service_account",...}'
GOOGLE_CALENDAR_ID=primary  # ou ID do calendário específico
```

**LGPD:** `room_bookings.anonymized_at` segue migration 044 — job de anonimização deve incluir esta tabela.

## Como eu trabalho aqui

- Desenvolvimento em **Fases numeradas**; executo o lote inteiro sem pausar para
  confirmação item a item.
- Relatório técnico final em **português** (resumo por arquivo do que mudou).
- Migrations: `npm run migrate` (SQL idempotente, `IF NOT EXISTS`, em `src/migrations/sql/`).

## Windows / shell

- Operações de path: ferramenta PowerShell (não Bash com paths `C:\`).
- Commits: use `$msg = "linha1\`n\`nlinha2"` (backtick-n para newline) depois `git commit -m $msg`.
  Here-string `@' '@` falha em comandos compostos e às vezes em isolado. Heredoc bash `$(cat <<EOF)` também falha.
- Encerre commits com o trailer `Co-Authored-By:` (regra global).
