# Backlog de Features — InteliCore OOH

> Fonte: pesquisa NotebookLM (Asana + Broadsign + Edge1 + DoohClick + Solop) — 2026-06-24 (rodadas 1, 2 e 3)
> Para planejamento futuro. Sem IA / sem API de IA no escopo atual.

---

## Tier A — Alto impacto, encaixe imediato no que já existe

| Feature | Por quê interessa |
|---|---|
| **Proofing e Anotações Visuais** | Cliente marca correções diretamente na arte dentro do portal externo antes de ir pra impressão. Extensão natural do portal que já existe. |
| **Formulários de Intake Inteligentes** | Padroniza entrada de pedidos do comercial → gera tarefa estruturada automaticamente. Resolve o "chega por WhatsApp" que acontece em toda agência OOH. |
| **Regras de Automação de Status** | Ex: tarefa muda pra "Exibindo" → notifica financeiro para faturar. Workflow automation em cima do Kanban existente. |
| **Portal do Cliente com Auditoria Transparente (PoP)** | Centraliza fotos de comprovação de veiculação validadas, reduz contestação de fatura. Evolução direta do portal externo. |
| **Controle de Alçadas para Reservas (Holds)** | Exige aprovação de gerente para reservar pontos "premium" ou períodos longos. Evita bloqueio de inventário valioso por propostas incertas. |
| **Portfólios de Clientes/Agências** | Visão consolidada de todas as campanhas de uma agência ou marca. Diretoria acompanha status sem abrir campanha por campanha. |
| **Conformidade Fiscal Regionalizada** | Faturação adapta ISS e regras fiscais automaticamente pela cidade do ponto. Sem entrada manual por nota. |
| **Notificação Automática de "Campanha no Ar"** | Dispara e-mail ou push ao cliente assim que o PoP é validado internamente. Inicia o ciclo de faturamento mais cedo e melhora percepção de transparência. |
| **Ações em Lote para Status de Tarefas** | Atualiza simultaneamente o status de dezenas de pontos de uma rota ou campanha. Elimina processamento manual dos relatórios de campo no fim de cada bi-semana. |
| **Engine de Alertas de Vencimento de Documentos** | Notificações internas para renovação de alvarás e contratos de locação próximos do vencimento. Evita perda de pontos estratégicos e multas por operação irregular. |
| **Motor de Handoff Comercial-Produção** | Bloqueia o avanço de uma reserva para instalação sem o upload síncrono da Nota Fiscal ou Pedido de Inserção (PI). Gate de workflow no Kanban existente. |
| **Controle de Versão de Peças Criativas** | Repositório histórico que impede envio de arte desatualizada ou reprovada pelo cliente para a gráfica. Extensão natural do módulo de anexos. |
| **Consolidador de Provas de Exibição (PoP Batch Export)** | Exporta num único ZIP ou PDF todas as fotos georreferenciadas de uma campanha multi-pontos para envio imediato ao cliente. Extensão direta do portal PoP. |
| **Gestão de Prazos de Entrega de Materiais** | Alertas regressivos a partir da data de início da bi-semana, informando quantos dias restam para o recebimento da arte final antes do atraso logístico. |

---

## Tier B — Alto valor de negócio, requer estrutura nova

| Feature | Por quê interessa |
|---|---|
| **Linha de Tempo (Gantt) com Caminho Crítico** | Visualiza encadeamento: produção → transporte → colagem. Reagenda automaticamente se impressão atrasa. Fundamental pra gestão de campanhas OOH. |
| **Motor de Disponibilidade de Inventário** | BD de faces físicas com flag de ocupação — impede reservar a mesma face pra duas campanhas. Core do negócio OOH. |
| **Sistema de Hold Temporário com Expiração** | Reserva face durante negociação por X dias, libera automaticamente se contrato não fechar. Resolve gargalo comercial clássico. |
| **Calendário Comercial de Bi-semanas** | Suporte nativo ao ciclo de 14 dias padrão do mercado OOH para planejamento e faturação. |
| **Gestão de Ciclo de Vida do Ativo** | Histórico de cada face: manutenção, licenças municipais, fotos hero shot. Módulo de patrimônio OOH. |
| **Carga de Trabalho (Workload)** | Monitora capacidade das equipes de campo em tempo real. Evita sobrecarga de instaladores no mesmo dia. |
| **Gestão de Licenciamento Municipal** | Repositório de alvarás e taxas municipais vinculados a cada ponto, com alertas de vencimento. Evita multa por exibição sem licença. |
| **Previsão de Receita (Forecasting)** | Projeção financeira com base na ocupação confirmada + probabilidade do funil. Sem IA — cálculo sobre dados reais do sistema. |
| **Cálculo de Lucratividade por Campanha** | Integra custos operacionais (colagem, produção, energia) para mostrar margem real de cada contrato. |
| **Dashboards de Ociosidade Crítica** | Destaca faces que ficarão livres em breve ou com baixo histórico de venda. Dispara promoções rápidas antes do período vagar. |
| **Metas de Impressões Compartilhadas (Shared Goals)** | Vende volume global de impactos e o sistema distribui a veiculação entre um pool de telas. Sem IA — algoritmo de distribuição proporcional. |
| **Matriz de Ocupação Temporal (Grade de Disponibilidade)** | Tabela cruzando ativos físicos com bi-semanas/meses — identifica espaços livres de imediato sem consulta externa. Elimina overbooking e acelera cotações. |
| **Gerador Automático de Media Kits e Propostas** | Extrai fotos, medidas e descrições do BD de ativos para gerar PDF comercial padronizado por campanha. Reduz preparação de proposta de horas para minutos. |
| **Lógica de Campanha de Dominação (Takeover)** | Bloqueia em massa todas as faces de um local (estação, terminal) para um único anunciante com um clique. Facilita venda de pacotes premium de alta exclusividade. |
| **Repositório de Especificações Técnicas por Face** | Biblioteca interna por ID da face: medidas exatas, tipo de material (lona/adesivo) e gabaritos de arte. Previne erros de impressão e refrações. |
| **Controle de Estoque de Insumos (Materiais)** | Rastreia lonas, colas e adesivos nos galpões regionais vinculados às ordens de serviço. Evita interrupções de colagem por falta de material. |
| **Log de Manutenção Preventiva e Corretiva** | Histórico de vistorias e reparos estruturais por ponto ao longo do tempo. Aumenta vida útil dos ativos e evita acidentes ou multas por falta de conservação. |
| **Calculadora de BV e Comissões** | Motor interno que aplica regras de desconto e comissionamento de agências com base no faturamento real. Automatiza conciliação financeira com parceiros. |
| **Biblioteca de Hero Shots** | Arquivo das melhores fotos históricas de cada ponto em diferentes iluminações/ângulos para uso em apresentações comerciais. Material de vendas de alta qualidade sem campanha ativa. |
| **Gestão de Sub-redes e Pacotes Lógicos** | Agrupa faces por afinidade (ex: "Circuito Academias", "Rodovias Leste") para facilitar venda e reserva em lotes estratégicos. Lógica de categorização interna. |
| **Auditoria de Metadados Temporais (EXIF)** | Valida automaticamente a data e hora da foto de instalação para garantir que o check-in ocorreu dentro da janela contratada. Complementar à validação de GPS (Tier C). |
| **Calculadora de Saturação de Playlist DOOH** | Calcula o peso de cada anunciante no loop digital (ex: 15s em 90s) para impedir que o limite técnico de exibição seja excedido. Lógica puramente interna. |
| **Engine de Filtros de Atributos Estruturais** | Busca avançada por iluminação, sentido da via (Centro-Bairro) ou tipo de estrutura para match técnico rápido com o briefing do cliente. Query filtrada sobre BD de ativos. |
| **Fluxo de Notificação de "Tela Preta" ou Avaria** | Tickets internos para reporte de falhas físicas (lona rasgada, LED apagado), gerando automaticamente tarefa prioritária de manutenção. Sistema de chamados simples. |
| **Sistema de "Voo" de Colagem (Grouping)** | Agrupa manualmente dezenas de tarefas de instalação em uma única rota para despacho em lote e prestação de contas do colador. Melhora o Log de Rotas. |
| **Log de Manutenção Programada de Ativos** | Agenda interna de vistorias estruturais recorrentes por painel próprio. Previne acidentes e multas por falta de conservação física. Extensão do Log de Manutenção. |
| **Módulo de Gestão de Contratos de Locação (Lease Management)** | Cadastro centralizado de prazos e valores de aluguel pagos pela empresa para manter pontos ativos em terrenos de terceiros. Complementa Landowners e Licenciamento. |
| **Análise de Rentabilidade por Departamento ou Marca** | Cruza custos de manutenção e colagem com o faturamento por "raia" de negócio. Relatório interno sem dependência externa. Extensão de Lucratividade por Campanha. |
| **Geração de Ordens de Pagamento a Fornecedores (Gráficas)** | Cria autorizações de faturamento para gráficas e transportadoras assim que a colagem é confirmada. Automatiza o gateway financeiro pós-campo. |
| **Histórico de Comissionamento e BV por Agência** | Registro automático de bonificações devidas vinculadas ao status de recebimento das faturas. Extensão da Calculadora de BV com rastreabilidade temporal. |

---

## Tier C — Diferencial competitivo, complexidade alta

| Feature | Por quê interessa |
|---|---|
| **Validação de Metadados GPS de Fotos (PoP)** | Verifica se foto do instalador foi tirada nas coordenadas certas e na janela de tempo correta. Elimina fraude de PoP. |
| **Planeamento por Mapa Interativo** | Busca faces disponíveis por raio de distância ou POI. UI diferenciada pra proposta comercial. Pode usar Leaflet.js (sem API paga). |
| **Engine de Exclusividade de Categoria** | Bloqueia reserva de faces próximas pra marcas concorrentes da mesma categoria. Regra de negócio sofisticada. |
| **Multi-homing de Tarefas** | Tarefa "Instalação" aparece em Logística E Comercial sem duplicar. Sincronização cross-departamento. |
| **Gestão de SLAs Reversos** | Calcula prazo de entrega da arte a partir da data de veiculação. Alerta se estiver em risco. |
| **Módulo de Repasse a Proprietários (Landowners)** | Calcula taxas devidas a donos de terreno com base na ocupação real. Financeiro OOH específico. |
| **Cálculo Automatizado de Impacto (OTS/GRP)** | Relatório com métricas de fluxo e alcance por ponto. Requer dados de tráfego cadastrados manualmente ou importados; sem API de tráfego por ora. |
| **Mapeamento por Pontos de Interesse (POIs)** | Busca faces num raio ao redor de lojas/concessionárias do cliente. Dataset de POIs via importação manual ou Leaflet + OpenStreetMap (gratuito). |
| **Checklist de Controle de Qualidade Pós-Instalação** | Formulário obrigatório que o instalador preenche no campo (web responsivo) — limpeza, iluminação, estiramento da lona. Reduz vistorias de refação. |
| **Gestão de Rotas Otimizadas (Lógica Interna)** | Agrupa tarefas de instalação por proximidade geográfica (Haversine, sem API externa) para definir sequência do dia de campo. Reduz combustível e deslocamento. |
| **Programação de Rodízio de Criativos (Playlists)** | Define sequência e peso de exibição de artes de um mesmo cliente em telas digitais. Gestão de rede DOOH sem CMS externo. |
| **Monitoramento de Status de Exibição (Uptime)** | Registro manual ou ping simples para marcar tela digital como operando ou fora. Base para compensação contratual por tela preta. |

---

## Tier D — Futuro (requer IA ou API externa de terceiros)

| Feature | Dependência |
|---|---|
| **Smart Chat para Consulta de Inventário** | LLM / API de IA |
| **IA para Sugestão de Mix de Mídia** | ML — modelo preditivo |
| **Heat Maps de Fluxo Populacional** | API de tráfego pago (HERE, Google, Mapbox Traffic) |
| **Mediação Programática (Unified Mediation)** | Integração com DSPs / SSPs programáticos |
| **Transcodificação Automática de Criativos** | Pipeline de encoding cloud ou API de processamento de mídia |

---

## Tier E — Diferidas por infraestrutura (implantar quando a infra estiver pronta)

| Feature | Infra necessária |
|---|---|
| **Proofing e Anotações Visuais** | Fabric.js (canvas) — cliente marca correções diretamente na arte no portal externo. |
| **Conformidade Fiscal Regionalizada** | Módulo de faturamento — ISS e regras fiscais automáticas por cidade do ponto. |

---

## Descartados (fora do escopo ou muito nichados)

- **Planeamento Híbrido Static + Digital** — só faz sentido se o Grupo Inteli operar mídia digital OOH também.
- **Conciliação de BV e Comissionamento** — absorvida pela Calculadora de BV e Comissões (Tier B).
- **Sincronização Escritório-Campo via App Mobile** — exigiria app mobile separado; fora do stack atual.
