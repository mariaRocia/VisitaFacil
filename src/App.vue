<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

type Dealer = {
  id: number
  nome: string
  grupo_economico: string
  cnpj: string
  endereco: string
  cidade: string
  uf: string
  contato_principal: string
  whatsapp: string
  email: string
}

type Product = {
  id: number
  nome: string
  valor_unitario: number
}

type VisitType = {
  id: number
  nome: string
  descricao: string
  ativo: number
}

type Visit = {
  id: number
  concessionaria_id: number
  tipo_visita_id: number
  data_visita: string
  observacao: string
  gerou_proposta: number
  data_proxima_reuniao: string
  hora_proxima_reuniao: string
  concessionaria: string
  grupo_economico: string
  tipo_visita: string
  produtos: string
  produto_ids: string
  proposta_id?: number
}

type Dashboard = {
  concessionarias: number
  produtos: number
  visitas: number
  propostas: number
  propostas_em_andamento: number
  propostas_em_aberto: number
  propostas_ganhas: number
  propostas_perdidas: number
  taxa_propostas: number
  taxa_conversao: number
  valor_total_propostas: number
  valor_total_ganho: number
  ticket_medio: number
  proximas_calls: number
  recentes: Visit[]
}

type DashboardPeriod = 'semana' | 'mes' | 'ano' | 'todos'

type User = {
  id: number
  nome: string
  login: string
  email?: string
}

type ProposalItem = {
  id: number
  proposta_id: number
  produto_id: number
  produto: string
  valor_unitario_original: number
  valor_unitario_negociado: number
  quantidade: number
  valor_total_item: number
}

type Proposal = {
  id: number
  visita_id: number
  status: string
  finalizada: number
  valor_total: number
  observacao_proposta: string
  tem_nova_call: number
  data_hora_proxima_call: string
  observacao_proxima_call: string
  proxima_acao: string
  responsavel_followup: string
  motivo_perda: string
  observacao_final: string
  data_finalizacao: string
  data_visita: string
  observacao_visita: string
  concessionaria: string
  grupo_economico: string
  tipo_visita: string
  produtos: string
  itens?: ProposalItem[]
}

const apiBase = import.meta.env.VITE_API_URL || '/api'
const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'concessionarias', label: 'Concessionarias', icon: 'store' },
  { id: 'produtos', label: 'Produtos', icon: 'box' },
  { id: 'tipos', label: 'Tipos de visita', icon: 'tag' },
  { id: 'visitas', label: 'Consultar visitas', icon: 'calendar' },
  { id: 'propostas', label: 'Propostas', icon: 'check' },
]

const currentSection = ref('dashboard')
const loading = ref(false)
const saving = ref(false)
const deletingKey = ref('')
const message = ref('')
let messageTimer: number | undefined
const authMode = ref<'login' | 'cadastro' | 'recuperar' | 'redefinir'>('login')
const authLoading = ref(false)
const resetToken = ref('')
const token = ref(localStorage.getItem('vf_token') || '')
const currentUser = ref<User | null>(null)
const modal = ref<'dealer' | 'product' | 'type' | 'visit' | 'proposal' | null>(null)
const editingId = ref<number | null>(null)
const selectedProposal = ref<Proposal | null>(null)
const isMenuOpen = ref(false)
const dashboardPeriod = ref<DashboardPeriod>('mes')

const dealers = ref<Dealer[]>([])
const products = ref<Product[]>([])
const visitTypes = ref<VisitType[]>([])
const visits = ref<Visit[]>([])
const proposals = ref<Proposal[]>([])
const dashboard = ref<Dashboard>({
  concessionarias: 0,
  produtos: 0,
  visitas: 0,
  propostas: 0,
  propostas_em_andamento: 0,
  propostas_em_aberto: 0,
  propostas_ganhas: 0,
  propostas_perdidas: 0,
  taxa_propostas: 0,
  taxa_conversao: 0,
  valor_total_propostas: 0,
  valor_total_ganho: 0,
  ticket_medio: 0,
  proximas_calls: 0,
  recentes: [],
})

const dealerForm = reactive({
  nome: '',
  grupo_economico: '',
  cnpj: '',
  endereco: '',
  cidade: '',
  uf: '',
  contato_principal: '',
  whatsapp: '',
  email: '',
})

const productForm = reactive({ nome: '', valor_unitario: '' })
const typeForm = reactive({ nome: '', descricao: '', ativo: true })
const visitForm = reactive({
  concessionaria_id: '',
  tipo_visita_id: '',
  data_visita: '',
  produto_ids: [] as number[],
  observacao: '',
  gerou_proposta: false,
  data_proxima_reuniao: '',
  hora_proxima_reuniao: '',
})

const visitFilters = reactive({
  concessionaria_id: '',
  grupo_economico: '',
  tipo_visita_id: '',
  produto_id: '',
  data_inicial: '',
  data_final: '',
  gerou_proposta: '',
})

const proposalFilters = reactive({
  concessionaria_id: '',
  grupo_economico: '',
  tipo_visita_id: '',
  produto_id: '',
  status: '',
  data_inicial: '',
  data_final: '',
  proxima_call: '',
  abertas: '',
  ganhas: '',
  perdidas: '',
})

const dashboardPeriodOptions: Array<{ id: DashboardPeriod; label: string }> = [
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'ano', label: 'Ano' },
  { id: 'todos', label: 'Tudo' },
]

const authForm = reactive({
  nome: '',
  login: '',
  email: '',
  senha: '',
  nova_senha: '',
})

const proposalForm = reactive({
  status: 'Em andamento',
  finalizada: false,
  observacao_proposta: '',
  tem_nova_call: false,
  data_hora_proxima_call: '',
  observacao_proxima_call: '',
  proxima_acao: '',
  responsavel_followup: '',
  motivo_perda: '',
  observacao_final: '',
  itens: [] as ProposalItem[],
})

const proposalStatuses = ['Em andamento', 'Em aberto', 'Ganha', 'Perdida']
const nextActions = [
  'Enviar proposta formal',
  'Aguardar retorno',
  'Marcar nova reuniao',
  'Enviar material complementar',
  'Negociar valores',
  'Fechar contrato',
  'Sem proxima acao',
]

const activeVisitTypes = computed(() => visitTypes.value.filter((type) => type.ativo))
const groups = computed(() =>
  Array.from(new Set(dealers.value.map((dealer) => dealer.grupo_economico).filter(Boolean))).sort(),
)
const sectionTitle = computed(() => sections.find((section) => section.id === currentSection.value)?.label)
const dashboardRange = computed(() => getDashboardRange(dashboardPeriod.value))
const dashboardRangeLabel = computed(() => {
  const range = dashboardRange.value
  if (!range.data_inicial || !range.data_final) return 'Todos os periodos'
  return `${formatDate(range.data_inicial)} ate ${formatDate(range.data_final)}`
})

function iconPath(name: string) {
  const paths: Record<string, string> = {
    grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    store: 'M4 10h16l-1.2-6H5.2L4 10Zm2 0v10h12V10M9 20v-6h6v6',
    box: 'M4 7 12 3l8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10',
    tag: 'M4 4h8l8 8-8 8-8-8V4Zm5 5h.01',
    calendar: 'M5 4v3m14-3v3M4 8h16v12H4V8Zm3 4h3m4 0h3m-10 4h3m4 0h3',
    plus: 'M12 5v14M5 12h14',
    edit: 'M4 17.5V21h3.5L18 10.5 14.5 7 4 17.5ZM16 5l3 3',
    trash: 'M5 7h14M10 11v6m4-6v6M7 7l1 13h8l1-13M10 7V4h4v3',
    search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM16 16l5 5',
    check: 'M5 13l4 4L19 7',
    power: 'M12 3v8m5.7-5.3a8 8 0 1 1-11.4 0',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'M6 6l12 12M18 6 6 18',
  }
  return paths[name] ?? paths.grid
}

async function request<T>(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token.value) headers.Authorization = `Bearer ${token.value}`
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    })
  } catch {
    throw new Error('Nao foi possivel conectar ao servidor. Aguarde alguns segundos e tente novamente.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) clearSession()
    throw new Error(body.error || 'Erro ao processar requisicao')
  }
  return body as T
}

async function submitAuth() {
  authLoading.value = true
  try {
    if (authMode.value === 'recuperar') {
      const result = await request<{ message: string }>('/auth/recuperar-senha', {
        method: 'POST',
        body: JSON.stringify({ login: authForm.login }),
      })
      showMessage(result.message)
      authMode.value = 'login'
      authForm.login = ''
      return
    }

    if (authMode.value === 'redefinir') {
      const result = await request<{ message: string }>('/auth/redefinir-senha', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken.value, senha: authForm.nova_senha }),
      })
      showMessage(result.message)
      resetToken.value = ''
      authMode.value = 'login'
      authForm.nova_senha = ''
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    const result = await request<{ token: string; usuario: User }>(`/auth/${authMode.value}`, {
      method: 'POST',
      body: JSON.stringify(authForm),
    })
    setSession(result.token, result.usuario)
    Object.assign(authForm, { nome: '', login: '', email: '', senha: '', nova_senha: '' })
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    authLoading.value = false
  }
}

async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' })
  } catch {
    // Sessao local tambem e encerrada se o token ja estiver invalido no servidor.
  }
  clearSession()
}

function setSession(nextToken: string, user: User) {
  token.value = nextToken
  currentUser.value = user
  localStorage.setItem('vf_token', nextToken)
}

function clearSession() {
  token.value = ''
  currentUser.value = null
  localStorage.removeItem('vf_token')
}

async function loadAll() {
  loading.value = true
  try {
    const [dealerData, productData, typeData] = await Promise.all([
      request<Dealer[]>('/concessionarias'),
      request<Product[]>('/produtos'),
      request<VisitType[]>('/tipos-visita'),
    ])
    dealers.value = dealerData
    products.value = productData
    visitTypes.value = typeData
    await Promise.all([loadDashboard(), loadVisits(), loadProposals()])
  } catch (error) {
    showMessage(error)
  } finally {
    loading.value = false
  }
}

async function loadDashboard() {
  const params = new URLSearchParams()
  const range = dashboardRange.value
  if (range.data_inicial) params.set('data_inicial', range.data_inicial)
  if (range.data_final) params.set('data_final', range.data_final)
  dashboard.value = await request<Dashboard>(`/dashboard?${params.toString()}`)
}

async function loadVisits() {
  const params = new URLSearchParams()
  Object.entries(visitFilters).forEach(([key, value]) => {
    if (value) params.set(key, String(value))
  })
  visits.value = await request<Visit[]>(`/visitas?${params.toString()}`)
}

async function loadProposals() {
  const params = new URLSearchParams()
  Object.entries(proposalFilters).forEach(([key, value]) => {
    if (value) params.set(key, String(value))
  })
  proposals.value = await request<Proposal[]>(`/propostas?${params.toString()}`)
}

function showMessage(error: unknown) {
  const nextMessage = publicMessage(error instanceof Error ? error.message : String(error))
  if (message.value === nextMessage) return
  message.value = nextMessage
  if (messageTimer) window.clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => {
    message.value = ''
    messageTimer = undefined
  }, 2800)
}

function publicMessage(value: string) {
  if (
    /sql_mode|group by|select list|order by|mysql|tidb|syntax|database|expression #|nonaggregated|clause/i.test(value)
    || value.length > 160
  ) {
    return 'Nao foi possivel processar a solicitacao agora. Tente novamente em instantes.'
  }
  return value
}

function openDealer(dealer?: Dealer) {
  editingId.value = dealer?.id ?? null
  Object.assign(dealerForm, dealer ?? {
    nome: '',
    grupo_economico: '',
    cnpj: '',
    endereco: '',
    cidade: '',
    uf: '',
    contato_principal: '',
    whatsapp: '',
    email: '',
  })
  modal.value = 'dealer'
}

function openProduct(product?: Product) {
  editingId.value = product?.id ?? null
  productForm.nome = product?.nome ?? ''
  productForm.valor_unitario = product ? String(product.valor_unitario) : ''
  modal.value = 'product'
}

async function openProposal(proposal: Proposal) {
  try {
    const detail = await request<Proposal>(`/propostas/${proposal.id}`)
    selectedProposal.value = detail
    Object.assign(proposalForm, {
      status: detail.status,
      finalizada: Boolean(detail.finalizada),
      observacao_proposta: detail.observacao_proposta ?? '',
      tem_nova_call: Boolean(detail.tem_nova_call),
      data_hora_proxima_call: detail.data_hora_proxima_call ? detail.data_hora_proxima_call.slice(0, 16) : '',
      observacao_proxima_call: detail.observacao_proxima_call ?? '',
      proxima_acao: detail.proxima_acao ?? '',
      responsavel_followup: detail.responsavel_followup ?? '',
      motivo_perda: detail.motivo_perda ?? '',
      observacao_final: detail.observacao_final ?? '',
      itens: (detail.itens ?? []).map((item) => ({ ...item })),
    })
    modal.value = 'proposal'
  } catch (error) {
    showMessage(error)
  }
}

function openType(type?: VisitType) {
  editingId.value = type?.id ?? null
  Object.assign(typeForm, type ? { ...type, ativo: Boolean(type.ativo) } : { nome: '', descricao: '', ativo: true })
  modal.value = 'type'
}

function openVisit(visit?: Visit) {
  editingId.value = visit?.id ?? null
  Object.assign(visitForm, {
    concessionaria_id: visit ? String(visit.concessionaria_id) : '',
    tipo_visita_id: visit ? String(visit.tipo_visita_id) : '',
    data_visita: visit?.data_visita ?? new Date().toISOString().slice(0, 10),
    produto_ids: visit?.produto_ids ? visit.produto_ids.split(',').map(Number) : [],
    observacao: visit?.observacao ?? '',
    gerou_proposta: Boolean(visit?.gerou_proposta),
    data_proxima_reuniao: visit?.data_proxima_reuniao ?? '',
    hora_proxima_reuniao: visit?.hora_proxima_reuniao ?? '',
  })
  modal.value = 'visit'
}

function closeModal() {
  if (saving.value) return
  modal.value = null
  editingId.value = null
  selectedProposal.value = null
}

async function saveDealer() {
  if (saving.value) return
  saving.value = true
  const method = editingId.value ? 'PUT' : 'POST'
  const path = editingId.value ? `/concessionarias/${editingId.value}` : '/concessionarias'
  try {
    await request(path, { method, body: JSON.stringify(dealerForm) })
    modal.value = null
    editingId.value = null
    selectedProposal.value = null
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    saving.value = false
  }
}

async function saveProduct() {
  if (saving.value) return
  saving.value = true
  const method = editingId.value ? 'PUT' : 'POST'
  const path = editingId.value ? `/produtos/${editingId.value}` : '/produtos'
  try {
    await request(path, { method, body: JSON.stringify(productForm) })
    modal.value = null
    editingId.value = null
    selectedProposal.value = null
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    saving.value = false
  }
}

async function saveType() {
  if (saving.value) return
  saving.value = true
  const method = editingId.value ? 'PUT' : 'POST'
  const path = editingId.value ? `/tipos-visita/${editingId.value}` : '/tipos-visita'
  try {
    await request(path, { method, body: JSON.stringify({ ...typeForm, ativo: typeForm.ativo ? 1 : 0 }) })
    modal.value = null
    editingId.value = null
    selectedProposal.value = null
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    saving.value = false
  }
}

async function saveVisit() {
  if (saving.value) return
  const wasTurningOffProposal = editingId.value && !visitForm.gerou_proposta
  if (
    wasTurningOffProposal &&
    !window.confirm('Se ja existir proposta para esta visita, ela sera preservada. Deseja continuar?')
  ) {
    return
  }
  saving.value = true
  const payload = {
    concessionaria_id: Number(visitForm.concessionaria_id),
    tipo_visita_id: Number(visitForm.tipo_visita_id),
    data_visita: visitForm.data_visita,
    produto_ids: visitForm.produto_ids,
    observacao: visitForm.observacao,
    gerou_proposta: visitForm.gerou_proposta ? 1 : 0,
    data_proxima_reuniao: visitForm.data_proxima_reuniao,
    hora_proxima_reuniao: visitForm.hora_proxima_reuniao,
  }
  const method = editingId.value ? 'PUT' : 'POST'
  const path = editingId.value ? `/visitas/${editingId.value}` : '/visitas'
  try {
    const saved = await request<Visit & { warning?: string }>(path, { method, body: JSON.stringify(payload) })
    if (saved.warning) showMessage(saved.warning)
    modal.value = null
    editingId.value = null
    selectedProposal.value = null
    currentSection.value = 'visitas'
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    saving.value = false
  }
}

async function saveProposal() {
  if (!selectedProposal.value || saving.value) return
  saving.value = true
  try {
    await request(`/propostas/${selectedProposal.value.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...proposalForm,
        finalizada: proposalForm.finalizada ? 1 : 0,
        tem_nova_call: proposalForm.tem_nova_call ? 1 : 0,
      }),
    })
    modal.value = null
    editingId.value = null
    selectedProposal.value = null
    await loadAll()
    currentSection.value = 'propostas'
  } catch (error) {
    showMessage(error)
  } finally {
    saving.value = false
  }
}

async function removeEntity(kind: string, id: number) {
  const labels: Record<string, string> = {
    concessionarias: 'concessionaria',
    produtos: 'produto',
    'tipos-visita': 'tipo de visita',
    visitas: 'visita',
    propostas: 'proposta',
  }
  if (!window.confirm(`Excluir ${labels[kind]}?`)) return
  const key = `${kind}:${id}`
  if (deletingKey.value) return
  deletingKey.value = key
  try {
    await request(`/${kind}/${id}`, { method: 'DELETE' })
    await loadAll()
  } catch (error) {
    showMessage(error)
  } finally {
    deletingKey.value = ''
  }
}

async function toggleType(type: VisitType) {
  try {
    await request(`/tipos-visita/${type.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...type, ativo: type.ativo ? 0 : 1 }),
    })
    await loadAll()
  } catch (error) {
    showMessage(error)
  }
}

function setSection(section: string) {
  currentSection.value = section
  isMenuOpen.value = false
  if (section === 'visitas') void loadVisits().catch(showMessage)
  if (section === 'propostas') void loadProposals().catch(showMessage)
}

function setDashboardPeriod(period: DashboardPeriod) {
  dashboardPeriod.value = period
  void loadDashboard().catch(showMessage)
}

function openDashboardProposals(kind: 'todas' | 'abertas' | 'ganhas' | 'perdidas') {
  Object.assign(proposalFilters, {
    concessionaria_id: '',
    grupo_economico: '',
    tipo_visita_id: '',
    produto_id: '',
    status: '',
    data_inicial: dashboardRange.value.data_inicial,
    data_final: dashboardRange.value.data_final,
    proxima_call: '',
    abertas: kind === 'abertas' ? '1' : '',
    ganhas: kind === 'ganhas' ? '1' : '',
    perdidas: kind === 'perdidas' ? '1' : '',
  })
  currentSection.value = 'propostas'
  void loadProposals().catch(showMessage)
}

function clearFilters() {
  Object.assign(visitFilters, {
    concessionaria_id: '',
    grupo_economico: '',
    tipo_visita_id: '',
    produto_id: '',
    data_inicial: '',
    data_final: '',
    gerou_proposta: '',
  })
  void loadVisits().catch(showMessage)
}

function clearProposalFilters() {
  Object.assign(proposalFilters, {
    concessionaria_id: '',
    grupo_economico: '',
    tipo_visita_id: '',
    produto_id: '',
    status: '',
    data_inicial: '',
    data_final: '',
    proxima_call: '',
    abertas: '',
    ganhas: '',
    perdidas: '',
  })
  void loadProposals().catch(showMessage)
}

function toggleProduct(productId: number) {
  const index = visitForm.produto_ids.indexOf(productId)
  if (index >= 0) {
    visitForm.produto_ids.splice(index, 1)
  } else {
    visitForm.produto_ids.push(productId)
  }
}

function formatDate(value: string) {
  if (!value) return '-'
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR')
}

function formatDateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function getDashboardRange(period: DashboardPeriod) {
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = new Date(end)

  if (period === 'todos') return { data_inicial: '', data_final: '' }
  if (period === 'semana') start.setDate(end.getDate() - 6)
  if (period === 'mes') start.setDate(1)
  if (period === 'ano') {
    start.setMonth(0)
    start.setDate(1)
  }

  return {
    data_inicial: formatDateInput(start),
    data_final: formatDateInput(end),
  }
}

function formatDateTime(value: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value: number | string) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function updateProposalItem(item: ProposalItem) {
  const negotiated = Number(item.valor_unitario_negociado || 0)
  const quantity = Number(item.quantidade || 0)
  item.valor_total_item = Number((negotiated * quantity).toFixed(2))
}

function clearProposalCallFields() {
  if (proposalForm.tem_nova_call) return
  proposalForm.data_hora_proxima_call = ''
  proposalForm.observacao_proxima_call = ''
  proposalForm.proxima_acao = ''
  proposalForm.responsavel_followup = ''
}

const proposalFormTotal = computed(() =>
  proposalForm.itens.reduce((total, item) => total + Number(item.valor_total_item || 0), 0),
)

function formatMeeting(visit: Visit) {
  if (!visit.data_proxima_reuniao || !visit.hora_proxima_reuniao) return '-'
  return `${formatDate(visit.data_proxima_reuniao)} as ${visit.hora_proxima_reuniao.slice(0, 5)}`
}

function googleCalendarUrl(visit: Visit) {
  const { start, end } = calendarRange(visit)
  const title = `Nova reuniao - ${visit.concessionaria}`
  const details = calendarDescription(visit)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start.google}/${end.google}`,
    details,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function outlookCalendarUrl(visit: Visit) {
  const { start, end } = calendarRange(visit)
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `Nova reuniao - ${visit.concessionaria}`,
    startdt: start.outlook,
    enddt: end.outlook,
    body: calendarDescription(visit),
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

function googleProposalCalendarUrl(proposal: Proposal) {
  const { start, end } = proposalCalendarRange(proposal)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Follow-up proposta - ${proposal.concessionaria}`,
    dates: `${start.google}/${end.google}`,
    details: proposalCalendarDescription(proposal),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function outlookProposalCalendarUrl(proposal: Proposal) {
  const { start, end } = proposalCalendarRange(proposal)
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `Follow-up proposta - ${proposal.concessionaria}`,
    startdt: start.outlook,
    enddt: end.outlook,
    body: proposalCalendarDescription(proposal),
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

function proposalCalendarRange(proposal: Proposal) {
  const startDate = new Date(proposal.data_hora_proxima_call)
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  return {
    start: {
      google: formatGoogleDate(startDate),
      outlook: formatOutlookDate(startDate),
    },
    end: {
      google: formatGoogleDate(endDate),
      outlook: formatOutlookDate(endDate),
    },
  }
}

function proposalCalendarDescription(proposal: Proposal) {
  return [
    'Follow-up de proposta Visita Facil',
    `Concessionaria: ${proposal.concessionaria}`,
    `Grupo economico: ${proposal.grupo_economico || '-'}`,
    `Tipo: ${proposal.tipo_visita}`,
    `Produtos: ${proposal.produtos || '-'}`,
    `Status: ${proposal.status}`,
    `Responsavel: ${proposal.responsavel_followup || '-'}`,
    `Observacao: ${proposal.observacao_proxima_call || proposal.observacao_proposta || '-'}`,
  ].join('\n')
}

function calendarRange(visit: Visit) {
  const startDate = new Date(`${visit.data_proxima_reuniao}T${visit.hora_proxima_reuniao || '09:00'}:00`)
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  return {
    start: {
      google: formatGoogleDate(startDate),
      outlook: formatOutlookDate(startDate),
    },
    end: {
      google: formatGoogleDate(endDate),
      outlook: formatOutlookDate(endDate),
    },
  }
}

function calendarDescription(visit: Visit) {
  return [
    'Follow-up Visita Facil',
    `Concessionaria: ${visit.concessionaria}`,
    `Grupo economico: ${visit.grupo_economico || '-'}`,
    `Tipo: ${visit.tipo_visita}`,
    `Produtos: ${visit.produtos || '-'}`,
    `Observacao: ${visit.observacao || '-'}`,
  ].join('\n')
}

function formatGoogleDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`
}

function formatOutlookDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const reset = params.get('reset_token')
  if (reset) {
    resetToken.value = reset
    authMode.value = 'redefinir'
    return
  }

  if (!token.value) return
  try {
    currentUser.value = await request<User>('/auth/me')
    await loadAll()
  } catch (error) {
    showMessage(error)
  }
})
</script>

<template>
  <section v-if="!currentUser" class="auth-screen">
    <form class="auth-card" @submit.prevent="submitAuth">
      <div class="brand auth-brand">
        <div class="brand-mark">VF</div>
        <div>
          <strong>Visita Facil</strong>
          <span>Acesse sua area comercial</span>
        </div>
      </div>

      <div class="auth-tabs" role="group" aria-label="Acesso">
        <button type="button" :class="{ active: authMode === 'login' }" @click="authMode = 'login'">Login</button>
        <button type="button" :class="{ active: authMode === 'cadastro' }" @click="authMode = 'cadastro'">Cadastro</button>
      </div>

      <template v-if="authMode === 'recuperar'">
        <label>Login ou e-mail<input v-model="authForm.login" autocomplete="username" required /></label>
      </template>
      <template v-else-if="authMode === 'redefinir'">
        <label>Nova senha<input v-model="authForm.nova_senha" type="password" autocomplete="new-password" required /></label>
      </template>
      <template v-else>
        <label v-if="authMode === 'cadastro'">Nome<input v-model="authForm.nome" autocomplete="name" required /></label>
        <label>Login<input v-model="authForm.login" autocomplete="username" required /></label>
        <label v-if="authMode === 'cadastro'">E-mail<input v-model="authForm.email" type="email" autocomplete="email" required /></label>
        <label>Senha<input v-model="authForm.senha" type="password" :autocomplete="authMode === 'cadastro' ? 'new-password' : 'current-password'" required /></label>
      </template>

      <button class="btn primary full" type="submit" :disabled="authLoading">
        {{
          authLoading
            ? 'Processando...'
            : authMode === 'login'
              ? 'Entrar'
              : authMode === 'cadastro'
                ? 'Criar cadastro'
                : authMode === 'recuperar'
                  ? 'Enviar e-mail'
                  : 'Atualizar senha'
        }}
      </button>
      <div class="auth-links">
        <button v-if="authMode === 'login'" type="button" @click="authMode = 'recuperar'">Esqueci minha senha</button>
        <button v-else type="button" @click="authMode = 'login'">Voltar para login</button>
      </div>
    </form>
    <div v-if="message" class="toast">{{ message }}</div>
  </section>

  <div v-else class="app-shell">
    <header class="mobile-header">
      <div class="brand">
        <div class="brand-mark">VF</div>
        <div>
          <strong>Visita Facil</strong>
          <span>{{ currentUser.nome }}</span>
        </div>
      </div>
      <button
        class="menu-toggle"
        type="button"
        :aria-expanded="isMenuOpen"
        aria-controls="main-menu"
        aria-label="Abrir menu"
        @click="isMenuOpen = !isMenuOpen"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="iconPath(isMenuOpen ? 'close' : 'menu')" />
        </svg>
      </button>
    </header>

    <button
      v-if="isMenuOpen"
      class="menu-backdrop"
      type="button"
      aria-label="Fechar menu"
      @click="isMenuOpen = false"
    ></button>

    <aside id="main-menu" class="sidebar" :class="{ open: isMenuOpen }">
      <div class="brand">
        <div class="brand-mark">VF</div>
        <div>
          <strong>Visita Facil</strong>
          <span>{{ currentUser.nome }}</span>
        </div>
      </div>

      <nav class="nav-list" aria-label="Menu principal">
        <button
          v-for="section in sections"
          :key="section.id"
          class="nav-item"
          :class="{ active: currentSection === section.id }"
          type="button"
          @click="setSection(section.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath(section.icon)" /></svg>
          <span>{{ section.label }}</span>
        </button>
      </nav>

      <button class="nav-item logout-item" type="button" @click="logout">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('power')" /></svg>
        <span>Sair</span>
      </button>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div>
          <p class="eyebrow">Sistema web</p>
          <h1>{{ sectionTitle }}</h1>
        </div>
        <button class="btn primary" type="button" @click="openVisit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('plus')" /></svg>
          Nova visita
        </button>
      </header>

      <div v-if="message" class="toast">{{ message }}</div>

      <section v-if="currentSection === 'dashboard'" class="view-stack">
        <section class="dashboard-filter panel">
          <div>
            <h2>Periodo do dashboard</h2>
            <span>{{ dashboardRangeLabel }}</span>
          </div>
          <div class="period-tabs" role="group" aria-label="Periodo do dashboard">
            <button
              v-for="option in dashboardPeriodOptions"
              :key="option.id"
              type="button"
              :class="{ active: dashboardPeriod === option.id }"
              @click="setDashboardPeriod(option.id)"
            >
              {{ option.label }}
            </button>
          </div>
        </section>

        <div class="metrics-grid">
          <article class="metric-card">
            <span>Concessionarias</span>
            <strong>{{ dashboard.concessionarias }}</strong>
          </article>
          <article class="metric-card">
            <span>Produtos</span>
            <strong>{{ dashboard.produtos }}</strong>
          </article>
          <article class="metric-card">
            <span>Visitas registradas</span>
            <strong>{{ dashboard.visitas }}</strong>
          </article>
          <article class="metric-card highlight">
            <span>Taxa de propostas</span>
            <strong>{{ dashboard.taxa_propostas }}%</strong>
          </article>
          <article class="metric-card">
            <span>Propostas geradas</span>
            <strong>{{ dashboard.propostas }}</strong>
          </article>
          <button class="metric-card metric-button" type="button" @click="openDashboardProposals('todas')">
            <span>Propostas geradas</span>
            <strong>{{ dashboard.propostas }}</strong>
          </button>
          <button class="metric-card metric-button" type="button" @click="openDashboardProposals('abertas')">
            <span>Em aberto / andamento</span>
            <strong>{{ dashboard.propostas_em_aberto + dashboard.propostas_em_andamento }}</strong>
          </button>
          <button class="metric-card metric-button" type="button" @click="openDashboardProposals('ganhas')">
            <span>Propostas ganhas</span>
            <strong>{{ dashboard.propostas_ganhas }}</strong>
          </button>
          <button class="metric-card metric-button danger-soft" type="button" @click="openDashboardProposals('perdidas')">
            <span>Propostas perdidas</span>
            <strong>{{ dashboard.propostas_perdidas }}</strong>
          </button>
          <article class="metric-card">
            <span>Taxa de conversao</span>
            <strong>{{ dashboard.taxa_conversao }}%</strong>
          </article>
          <article class="metric-card highlight">
            <span>Total em propostas</span>
            <strong>{{ formatMoney(dashboard.valor_total_propostas) }}</strong>
          </article>
        </div>

        <div class="quick-grid">
          <button class="quick-action" type="button" @click="openDealer()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('store')" /></svg>
            Cadastrar concessionaria
          </button>
          <button class="quick-action" type="button" @click="openProduct()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('box')" /></svg>
            Cadastrar produto
          </button>
          <button class="quick-action" type="button" @click="setSection('visitas')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('search')" /></svg>
            Consultar visitas
          </button>
          <button class="quick-action" type="button" @click="setSection('propostas')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('check')" /></svg>
            Consultar propostas
          </button>
        </div>

        <!-- IA desativada: painel de insights removido da interface. -->

        <section class="panel">
          <div class="panel-heading">
            <h2>Visitas recentes</h2>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Concessionaria</th>
                  <th>Tipo</th>
                  <th>Produtos</th>
                  <th>Proposta</th>
                  <th>Proxima reuniao</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="visit in dashboard.recentes" :key="visit.id">
                  <td data-label="Data">{{ formatDate(visit.data_visita) }}</td>
                  <td data-label="Concessionaria">{{ visit.concessionaria }}</td>
                  <td data-label="Tipo">{{ visit.tipo_visita }}</td>
                  <td data-label="Produtos">{{ visit.produtos }}</td>
                  <td data-label="Proposta"><span :class="['badge', visit.gerou_proposta ? 'success' : 'muted']">{{ visit.gerou_proposta ? 'Sim' : 'Nao' }}</span></td>
                  <td data-label="Proxima reuniao">{{ formatMeeting(visit) }}</td>
                </tr>
                <tr v-if="!dashboard.recentes.length">
                  <td colspan="6" class="empty">Nenhuma visita registrada.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section v-if="currentSection === 'concessionarias'" class="panel">
        <div class="panel-heading">
          <h2>Concessionarias</h2>
          <button class="btn primary" type="button" @click="openDealer()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('plus')" /></svg>
            Nova
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Grupo</th>
                <th>Cidade/UF</th>
                <th>Contato</th>
                <th class="actions">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dealer in dealers" :key="dealer.id">
                <td>{{ dealer.nome }}</td>
                <td>{{ dealer.grupo_economico }}</td>
                <td>{{ dealer.cidade }}/{{ dealer.uf }}</td>
                <td>{{ dealer.contato_principal }}<br /><small>{{ dealer.whatsapp }}</small></td>
                <td class="actions">
                  <button class="icon-btn" type="button" @click="openDealer(dealer)"><svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg></button>
                  <button class="icon-btn danger" type="button" :disabled="Boolean(deletingKey)" @click="removeEntity('concessionarias', dealer.id)"><svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="currentSection === 'produtos'" class="panel narrow">
        <div class="panel-heading">
          <h2>Produtos</h2>
          <button class="btn primary" type="button" @click="openProduct()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('plus')" /></svg>
            Novo
          </button>
        </div>
        <div class="list-grid">
          <article v-for="product in products" :key="product.id" class="list-card">
            <div>
              <strong>{{ product.nome }}</strong>
              <small>{{ formatMoney(product.valor_unitario) }}</small>
            </div>
            <div class="row-actions">
              <button class="icon-btn" type="button" @click="openProduct(product)"><svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg></button>
              <button class="icon-btn danger" type="button" :disabled="Boolean(deletingKey)" @click="removeEntity('produtos', product.id)"><svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg></button>
            </div>
          </article>
        </div>
      </section>

      <section v-if="currentSection === 'tipos'" class="panel">
        <div class="panel-heading">
          <h2>Tipos de visita</h2>
          <button class="btn primary" type="button" @click="openType()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath('plus')" /></svg>
            Novo
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Descricao</th>
                <th>Status</th>
                <th class="actions">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="type in visitTypes" :key="type.id">
                <td>{{ type.nome }}</td>
                <td>{{ type.descricao }}</td>
                <td><span :class="['badge', type.ativo ? 'success' : 'muted']">{{ type.ativo ? 'Ativo' : 'Inativo' }}</span></td>
                <td class="actions">
                  <button class="icon-btn" type="button" @click="openType(type)"><svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg></button>
                  <button class="icon-btn" type="button" @click="toggleType(type)"><svg viewBox="0 0 24 24"><path :d="iconPath('power')" /></svg></button>
                  <button class="icon-btn danger" type="button" :disabled="Boolean(deletingKey)" @click="removeEntity('tipos-visita', type.id)"><svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="currentSection === 'visitas'" class="view-stack">
        <section class="panel">
          <div class="panel-heading">
            <h2>Filtros</h2>
          </div>
          <form class="filters" @submit.prevent="loadVisits">
            <select v-model="visitFilters.concessionaria_id">
              <option value="">Concessionaria</option>
              <option v-for="dealer in dealers" :key="dealer.id" :value="dealer.id">{{ dealer.nome }}</option>
            </select>
            <select v-model="visitFilters.grupo_economico">
              <option value="">Grupo economico</option>
              <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
            </select>
            <select v-model="visitFilters.tipo_visita_id">
              <option value="">Tipo de visita</option>
              <option v-for="type in visitTypes" :key="type.id" :value="type.id">{{ type.nome }}</option>
            </select>
            <select v-model="visitFilters.produto_id">
              <option value="">Produto</option>
              <option v-for="product in products" :key="product.id" :value="product.id">{{ product.nome }}</option>
            </select>
            <input v-model="visitFilters.data_inicial" type="date" />
            <input v-model="visitFilters.data_final" type="date" />
            <select v-model="visitFilters.gerou_proposta">
              <option value="">Proposta</option>
              <option value="1">Sim</option>
              <option value="0">Nao</option>
            </select>
            <div class="filter-actions">
              <button class="btn primary" type="submit">Filtrar</button>
              <button class="btn ghost" type="button" @click="clearFilters">Limpar</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="proposal-cards">
            <article v-for="proposal in proposals" :key="proposal.id" class="proposal-card">
              <header class="proposal-card-head">
                <div>
                  <strong>{{ proposal.concessionaria }}</strong>
                  <span>{{ proposal.grupo_economico || 'Sem grupo informado' }}</span>
                </div>
                <span :class="['badge', proposal.finalizada ? 'success' : 'muted']">{{ proposal.status }}</span>
              </header>

              <div class="proposal-card-value">
                <span>Valor total</span>
                <strong>{{ formatMoney(proposal.valor_total) }}</strong>
              </div>

              <dl class="proposal-card-info">
                <div>
                  <dt>Data</dt>
                  <dd>{{ formatDate(proposal.data_visita) }}</dd>
                </div>
                <div>
                  <dt>Tipo</dt>
                  <dd>{{ proposal.tipo_visita }}</dd>
                </div>
                <div class="full">
                  <dt>Produtos</dt>
                  <dd>{{ proposal.produtos || '-' }}</dd>
                </div>
                <div class="full">
                  <dt>Responsavel</dt>
                  <dd>{{ proposal.responsavel_followup || '-' }}</dd>
                </div>
              </dl>

              <section class="proposal-call-card">
                <span>Proxima call</span>
                <template v-if="proposal.tem_nova_call && proposal.data_hora_proxima_call">
                  <strong>{{ formatDateTime(proposal.data_hora_proxima_call) }}</strong>
                  <div class="calendar-actions">
                    <a class="calendar-link" :href="googleProposalCalendarUrl(proposal)" target="_blank" rel="noreferrer">Google</a>
                    <a class="calendar-link" :href="outlookProposalCalendarUrl(proposal)" target="_blank" rel="noreferrer">Teams</a>
                  </div>
                </template>
                <strong v-else>-</strong>
              </section>

              <footer class="proposal-card-actions">
                <button class="icon-btn" type="button" title="Editar proposta" @click="openProposal(proposal)">
                  <svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg>
                </button>
                <button class="icon-btn danger" type="button" title="Excluir proposta" :disabled="Boolean(deletingKey)" @click="removeEntity('propostas', proposal.id)">
                  <svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg>
                </button>
              </footer>
            </article>
            <p v-if="!proposals.length" class="empty">Nenhuma proposta encontrada.</p>
          </div>

          <div class="table-wrap proposal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Concessionaria</th>
                  <th>Grupo economico</th>
                  <th>Tipo de visita</th>
                  <th>Produtos</th>
                  <th>Proposta</th>
                  <th>Proxima reuniao</th>
                  <th class="actions">Acoes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="visit in visits" :key="visit.id">
                  <td data-label="Data">{{ formatDate(visit.data_visita) }}</td>
                  <td data-label="Concessionaria">{{ visit.concessionaria }}</td>
                  <td data-label="Grupo economico">{{ visit.grupo_economico }}</td>
                  <td data-label="Tipo de visita">{{ visit.tipo_visita }}</td>
                  <td data-label="Produtos">{{ visit.produtos }}</td>
                  <td data-label="Proposta"><span :class="['badge', visit.gerou_proposta ? 'success' : 'muted']">{{ visit.gerou_proposta ? 'Sim' : 'Nao' }}</span></td>
                  <td data-label="Proxima reuniao">{{ formatMeeting(visit) }}</td>
                  <td class="actions" data-label="Acoes">
                    <button class="icon-btn" type="button" @click="openVisit(visit)"><svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg></button>
                    <span v-if="visit.data_proxima_reuniao && visit.hora_proxima_reuniao" class="calendar-actions">
                      <a class="calendar-link" :href="googleCalendarUrl(visit)" target="_blank" rel="noreferrer">Google</a>
                      <a class="calendar-link" :href="outlookCalendarUrl(visit)" target="_blank" rel="noreferrer">Teams</a>
                    </span>
                    <button class="icon-btn danger" type="button" :disabled="Boolean(deletingKey)" @click="removeEntity('visitas', visit.id)"><svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg></button>
                  </td>
                </tr>
                <tr v-if="!visits.length">
                  <td colspan="8" class="empty">Nenhuma visita encontrada.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section v-if="currentSection === 'propostas'" class="view-stack">
        <section class="panel">
          <div class="panel-heading">
            <h2>Filtros de propostas</h2>
          </div>
          <form class="filters" @submit.prevent="loadProposals">
            <select v-model="proposalFilters.concessionaria_id">
              <option value="">Concessionaria</option>
              <option v-for="dealer in dealers" :key="dealer.id" :value="dealer.id">{{ dealer.nome }}</option>
            </select>
            <select v-model="proposalFilters.grupo_economico">
              <option value="">Grupo economico</option>
              <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
            </select>
            <select v-model="proposalFilters.tipo_visita_id">
              <option value="">Tipo de visita</option>
              <option v-for="type in visitTypes" :key="type.id" :value="type.id">{{ type.nome }}</option>
            </select>
            <select v-model="proposalFilters.produto_id">
              <option value="">Produto</option>
              <option v-for="product in products" :key="product.id" :value="product.id">{{ product.nome }}</option>
            </select>
            <select v-model="proposalFilters.status">
              <option value="">Status</option>
              <option v-for="status in proposalStatuses" :key="status" :value="status">{{ status }}</option>
            </select>
            <input v-model="proposalFilters.data_inicial" type="date" />
            <input v-model="proposalFilters.data_final" type="date" />
            <select v-model="proposalFilters.proxima_call">
              <option value="">Proxima call</option>
              <option value="1">Com call marcada</option>
            </select>
            <select v-model="proposalFilters.abertas">
              <option value="">Propostas em aberto</option>
              <option value="1">Sim</option>
            </select>
            <select v-model="proposalFilters.ganhas">
              <option value="">Propostas ganhas</option>
              <option value="1">Sim</option>
            </select>
            <select v-model="proposalFilters.perdidas">
              <option value="">Propostas perdidas</option>
              <option value="1">Sim</option>
            </select>
            <div class="filter-actions">
              <button class="btn primary" type="submit">Filtrar</button>
              <button class="btn ghost" type="button" @click="clearProposalFilters">Limpar</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data da visita</th>
                  <th>Concessionaria</th>
                  <th>Grupo economico</th>
                  <th>Tipo</th>
                  <th>Produtos</th>
                  <th>Valor total</th>
                  <th>Status</th>
                  <th>Proxima call</th>
                  <th>Responsavel</th>
                  <th class="actions">Acoes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="proposal in proposals" :key="proposal.id">
                  <td data-label="Data da visita">{{ formatDate(proposal.data_visita) }}</td>
                  <td data-label="Concessionaria">{{ proposal.concessionaria }}</td>
                  <td data-label="Grupo economico">{{ proposal.grupo_economico }}</td>
                  <td data-label="Tipo">{{ proposal.tipo_visita }}</td>
                  <td data-label="Produtos">{{ proposal.produtos }}</td>
                  <td data-label="Valor total">{{ formatMoney(proposal.valor_total) }}</td>
                  <td data-label="Status"><span :class="['badge', proposal.finalizada ? 'success' : 'muted']">{{ proposal.status }}</span></td>
                  <td data-label="Proxima call">
                    <div v-if="proposal.tem_nova_call && proposal.data_hora_proxima_call" class="call-cell">
                      <span>{{ formatDateTime(proposal.data_hora_proxima_call) }}</span>
                      <span class="calendar-actions">
                        <a class="calendar-link" :href="googleProposalCalendarUrl(proposal)" target="_blank" rel="noreferrer">Google</a>
                        <a class="calendar-link" :href="outlookProposalCalendarUrl(proposal)" target="_blank" rel="noreferrer">Teams</a>
                      </span>
                    </div>
                    <span v-else>-</span>
                  </td>
                  <td data-label="Responsavel">{{ proposal.responsavel_followup || '-' }}</td>
                  <td class="actions" data-label="Acoes">
                    <button class="icon-btn" type="button" title="Editar proposta" @click="openProposal(proposal)">
                      <svg viewBox="0 0 24 24"><path :d="iconPath('edit')" /></svg>
                    </button>
                    <button class="icon-btn danger" type="button" :disabled="Boolean(deletingKey)" @click="removeEntity('propostas', proposal.id)"><svg viewBox="0 0 24 24"><path :d="iconPath('trash')" /></svg></button>
                  </td>
                </tr>
                <tr v-if="!proposals.length">
                  <td colspan="10" class="empty">Nenhuma proposta encontrada.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <div v-if="loading" class="loading">Carregando...</div>
    </main>

    <div v-if="modal" class="modal-backdrop" @click.self="closeModal">
      <section class="modal-card">
        <header class="modal-heading">
          <h2>
            {{
              modal === 'dealer'
                ? 'Concessionaria'
                : modal === 'product'
                  ? 'Produto'
                  : modal === 'type'
                    ? 'Tipo de visita'
                    : modal === 'proposal'
                      ? 'Proposta'
                      : 'Visita'
            }}
          </h2>
          <button class="close-btn" type="button" :disabled="saving" @click="closeModal">x</button>
        </header>

        <form v-if="modal === 'dealer'" class="form-grid" @submit.prevent="saveDealer">
          <label>Nome da concessionaria<input v-model="dealerForm.nome" required /></label>
          <label>Grupo economico<input v-model="dealerForm.grupo_economico" /></label>
          <label>CNPJ<input v-model="dealerForm.cnpj" /></label>
          <label>Endereco<input v-model="dealerForm.endereco" /></label>
          <label>Cidade<input v-model="dealerForm.cidade" /></label>
          <label>UF<input v-model="dealerForm.uf" maxlength="2" /></label>
          <label>Contato principal<input v-model="dealerForm.contato_principal" /></label>
          <label>WhatsApp<input v-model="dealerForm.whatsapp" /></label>
          <label class="full">E-mail<input v-model="dealerForm.email" type="email" /></label>
          <button class="btn primary full" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar concessionaria' }}</button>
        </form>

        <form v-if="modal === 'product'" class="form-grid single" @submit.prevent="saveProduct">
          <label>Nome do produto<input v-model="productForm.nome" required /></label>
          <label>Valor unitario<input v-model="productForm.valor_unitario" type="number" min="0.01" step="0.01" required /></label>
          <button class="btn primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar produto' }}</button>
        </form>

        <form v-if="modal === 'type'" class="form-grid" @submit.prevent="saveType">
          <label>Nome do tipo de visita<input v-model="typeForm.nome" required /></label>
          <label class="full">Descricao<textarea v-model="typeForm.descricao" rows="4"></textarea></label>
          <label class="switch full"><input v-model="typeForm.ativo" type="checkbox" /> Ativo</label>
          <button class="btn primary full" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar tipo' }}</button>
        </form>

        <form v-if="modal === 'visit'" class="form-grid" @submit.prevent="saveVisit">
          <label>
            Concessionaria
            <select v-model="visitForm.concessionaria_id" required>
              <option value="">Selecione</option>
              <option v-for="dealer in dealers" :key="dealer.id" :value="dealer.id">{{ dealer.nome }}</option>
            </select>
          </label>
          <label>
            Tipo de visita
            <select v-model="visitForm.tipo_visita_id" required>
              <option value="">Selecione</option>
              <option v-for="type in activeVisitTypes" :key="type.id" :value="type.id">{{ type.nome }}</option>
            </select>
          </label>
          <label>Data da visita<input v-model="visitForm.data_visita" type="date" required /></label>
          <label class="full">Observacao<textarea v-model="visitForm.observacao" rows="4"></textarea></label>
          <!-- IA desativada: resumo automatico da visita removido da interface. -->
          <fieldset class="product-picker full">
            <legend>Produtos negociados</legend>
            <label v-for="product in products" :key="product.id">
              <input
                type="checkbox"
                :checked="visitForm.produto_ids.includes(product.id)"
                @change="toggleProduct(product.id)"
              />
              {{ product.nome }}
            </label>
          </fieldset>
          <label class="switch full"><input v-model="visitForm.gerou_proposta" type="checkbox" /> Gerou proposta?</label>
          <label>Data da nova reuniao<input v-model="visitForm.data_proxima_reuniao" type="date" /></label>
          <label>Hora da nova reuniao<input v-model="visitForm.hora_proxima_reuniao" type="time" /></label>
          <button class="btn primary full" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar visita' }}</button>
        </form>

        <form v-if="modal === 'proposal' && selectedProposal" class="proposal-detail" @submit.prevent="saveProposal">
          <section class="detail-block">
            <h3>Dados da visita</h3>
            <div class="detail-grid">
              <p><strong>Concessionaria</strong><span>{{ selectedProposal.concessionaria }}</span></p>
              <p><strong>Grupo economico</strong><span>{{ selectedProposal.grupo_economico || '-' }}</span></p>
              <p><strong>Data da visita</strong><span>{{ formatDate(selectedProposal.data_visita) }}</span></p>
              <p><strong>Tipo de visita</strong><span>{{ selectedProposal.tipo_visita }}</span></p>
              <p class="full"><strong>Produtos negociados</strong><span>{{ selectedProposal.produtos }}</span></p>
            </div>
            <label class="full">Observacao da visita<textarea :value="selectedProposal.observacao_visita" rows="4" readonly></textarea></label>
          </section>

          <section class="detail-block">
            <h3>Produtos e valores da proposta</h3>
            <div class="table-wrap">
              <table class="proposal-items">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Valor original</th>
                    <th>Valor negociado</th>
                    <th>Quantidade</th>
                    <th>Total item</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in proposalForm.itens" :key="item.id">
                    <td>{{ item.produto }}</td>
                    <td>{{ formatMoney(item.valor_unitario_original) }}</td>
                    <td>
                      <input
                        v-model.number="item.valor_unitario_negociado"
                        type="number"
                        min="0"
                        step="0.01"
                        @input="updateProposalItem(item)"
                      />
                    </td>
                    <td>
                      <input
                        v-model.number="item.quantidade"
                        type="number"
                        min="0.01"
                        step="0.01"
                        @input="updateProposalItem(item)"
                      />
                    </td>
                    <td>{{ formatMoney(item.valor_total_item) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="proposal-total">
              <span>Valor total da proposta</span>
              <strong>{{ formatMoney(proposalFormTotal) }}</strong>
            </div>
          </section>

          <section class="detail-block">
            <h3>Observacoes comerciais</h3>
            <label>Observacao da proposta<textarea v-model="proposalForm.observacao_proposta" rows="4"></textarea></label>
          </section>

          <section class="detail-block">
            <h3>Proxima call e follow-up</h3>
            <div class="form-grid">
              <label class="switch full"><input v-model="proposalForm.tem_nova_call" type="checkbox" @change="clearProposalCallFields" /> Tem nova call marcada?</label>
              <template v-if="proposalForm.tem_nova_call">
                <label>Data e hora da proxima call<input v-model="proposalForm.data_hora_proxima_call" type="datetime-local" /></label>
                <label>
                  Proxima acao
                  <select v-model="proposalForm.proxima_acao">
                    <option value="">Selecione</option>
                    <option v-for="action in nextActions" :key="action" :value="action">{{ action }}</option>
                  </select>
                </label>
                <label>Responsavel pelo follow-up<input v-model="proposalForm.responsavel_followup" /></label>
                <label class="full">Observacao da proxima call<textarea v-model="proposalForm.observacao_proxima_call" rows="3"></textarea></label>
              </template>
            </div>
          </section>

          <section class="detail-block">
            <h3>Status e finalizacao</h3>
            <div class="form-grid">
              <label>
                Status da proposta
                <select v-model="proposalForm.status">
                  <option v-for="status in proposalStatuses" :key="status" :value="status">{{ status }}</option>
                </select>
              </label>
              <label class="switch"><input v-model="proposalForm.finalizada" type="checkbox" /> Proposta finalizada?</label>
              <label v-if="proposalForm.status === 'Perdida'" class="full">Motivo da perda<textarea v-model="proposalForm.motivo_perda" rows="3"></textarea></label>
              <label v-if="proposalForm.status === 'Ganha' || proposalForm.status === 'Perdida'" class="full">Observacao final<textarea v-model="proposalForm.observacao_final" rows="3"></textarea></label>
            </div>
          </section>

          <button class="btn primary full" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar proposta' }}</button>
        </form>

      </section>
    </div>
  </div>
</template>
