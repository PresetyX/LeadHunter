# LeadHunter

**SaaS de geração de leads B2B para empresas locais.** Informe um *nicho* (ex.: "dentista") e uma *cidade* (ex.: "Jundiaí") e receba uma lista de empresas com telefone, WhatsApp, site, e-mail e redes sociais, pronta para exportar em CSV (Excel) ou XLSX e usar em prospecção.

> Produção: <https://leadhunter-xi-indol.vercel.app>

---

## 1. Visão geral da plataforma

Prospectar empresas locais costuma significar horas copiando dados do Google Maps, procurando o site de cada negócio e caçando um e-mail ou WhatsApp. O LeadHunter automatiza esse fluxo em uma busca de menos de um minuto:

1. **Coleta** os estabelecimentos na base oficial do Google Maps (Places API).
2. **Normaliza e deduplica** os registros (telefones no padrão `55DDDNÚMERO`, URLs limpas, duplicatas fundidas).
3. **Enriquece** cada empresa visitando o site dela: e-mail, WhatsApp, Instagram, Facebook, LinkedIn, TikTok e YouTube.
4. **Entrega** a tabela na tela, em tempo real, e permite exportar para CSV (UTF-8 com BOM, abre direto no Excel) ou XLSX.

O produto é vendido com acesso pago (Mercado Pago, Pix ou cartão), com planos por volume de leads e travas de uso para proteger a margem e a cota da API do Google.

### Para quem é

- **Agências de marketing e social media**, que precisam de listas segmentadas por nicho e região.
- **Vendedores e SDRs B2B**, que fazem cold call, WhatsApp e e-mail frio.
- **Freelancers e prestadores de serviço** (sites, tráfego pago, automação, contabilidade) que prospectam negócios locais.
- **Consultorias e franquias**, para mapear mercado e concorrência por cidade.

---

## 2. Arquitetura e tecnologias

| Camada | Tecnologia |
| --- | --- |
| Front-end e back-end | **Next.js 15** (App Router), **React 19**, **TypeScript** |
| Estilo | Tailwind CSS 3, ícones Lucide, tema escuro com verde neon (`#A9EA2E` / `#82C91E`) |
| Runtime | **Node.js** (>= 20), funções serverless na **Vercel** (região `gru1`, São Paulo) |
| Fonte de dados principal | **Google Places API (New)**, Text Search |
| Fontes alternativas | Outscraper (opcional) e OpenStreetMap (Nominatim + Overpass, gratuito) |
| Pagamentos | **Mercado Pago** (Checkout Pro: Pix e cartão) + webhook assinado |
| Autenticação | Sessão em cookie JWT (`jose`), senhas com hash, sessão de um dispositivo por vez |
| Armazenamento | **Vercel Blob** (privado) ou **Postgres** (Neon), escolhido por variável de ambiente |
| Planilhas | ExcelJS (XLSX), geração de CSV própria |
| Métricas | Vercel Web Analytics |

### Fluxo de uma busca

```
Navegador ──POST /api/search──▶ valida sessão e pagamento
                                  │
                                  ├─ reserva a busca na cota do usuário (operação atômica)
                                  ├─ cache de 7 dias? ──sim──▶ devolve do cache (não consulta o Google)
                                  │
                                  ├─ 1) Google Places  (principal; com trava global mensal de chamadas)
                                  ├─ 2) Outscraper     (opcional, só se configurado e o Google não trouxe nada)
                                  ├─ 3) OpenStreetMap  (último recurso, gratuito)
                                  │
                                  ├─ dedupe ─▶ envia resultado parcial na hora (streaming NDJSON)
                                  ├─ enriquecimento dos sites (e-mail, WhatsApp, redes sociais)
                                  └─ grava no cache e debita os leads entregues
```

Pontos de desenho que valem destacar:

- **Streaming NDJSON.** A resposta chega por eventos (`status`, `partial`, `result`, `error`), então a tela mostra progresso e os primeiros leads antes do fim do enriquecimento.
- **Cancelamento real.** O botão *Parar* fecha a conexão e o servidor interrompe a busca de verdade: não gasta API, não enriquece sites e não debita leads que ninguém recebeu.
- **Limite do serverless.** A função tem orçamento interno de 52 s (`maxDuration = 60`). Perto do limite, devolve o que já foi enriquecido em vez de estourar o timeout.
- **Cobertura de cidades grandes.** O Google devolve no máximo 60 lugares por consulta. Para cobrir mais, a busca roda sinônimos do nicho e divide o mapa da cidade em quadrantes enquanto as consultas "lotarem", sempre dentro de um teto de chamadas por busca.
- **Cache de 7 dias.** Buscas repetidas saem do cache, sem nova chamada à API e sem consumir leads de quem repete a busca.
- **Trava de custo da Google.** Um contador global mensal bloqueia novas chamadas ao Google ao atingir o teto configurado e a busca cai para o OpenStreetMap, em vez de gerar cobrança inesperada.

### Estrutura do repositório

```
app/                 páginas e rotas de API (App Router)
  api/auth/          login, logout, registro, sessão
  api/search/        busca de leads em streaming
  api/export/        exportação XLSX
  api/checkout/      criação do pagamento e verificação
  api/webhooks/      webhook do Mercado Pago
components/          interface (dashboard, preços, painel de uso)
lib/                 regras de negócio
  sources/           Google Places, Outscraper, OpenStreetMap
  plan.ts            catálogo de produtos, preços e limites
  pricing.ts         promoção dinâmica (vitalício x mensal)
  quota.ts           cotas de leads e buscas por dia
  places-budget.ts   trava global mensal de chamadas ao Google
  enrich.ts          extração de e-mail, WhatsApp e redes sociais
tests/               testes automatizados (node:test)
```

---

## 3. Funcionalidades e casos de uso de negócio

### Funcionalidades

- **Busca por nicho e cidade**, com sinônimos do nicho para aumentar a cobertura.
- **Dados por lead:** nome, categoria, endereço, telefone, WhatsApp, site, e-mail, redes sociais, nota e número de avaliações.
- **Enriquecimento automático** dos sites das empresas.
- **Exportação** em CSV (UTF-8-SIG, separador `;`, telefones preservados no Excel) e XLSX (cabeçalho fixo, filtros, links clicáveis, WhatsApp como link `wa.me`), com proteção contra injeção de fórmula.
- **Painel de uso:** leads restantes, buscas do dia e validade do plano.
- **Pagamento por Pix ou cartão** via Mercado Pago, com liberação automática do acesso.
- **Painel de upgrade** quando o limite acaba: pacote de créditos extra ou migração para um plano mensal.
- **Modo de pré-visualização de preços** (`dev-toggle`), visível apenas para e-mails listados em `ADMIN_EMAILS`, para ver a transição entre a oferta vitalícia e os planos mensais.

### Modelo comercial

**Oferta de lançamento (primeiras 50 vendas).** Enquanto houver menos de 50 vendas concluídas, a página de preços destaca o plano vitalício e uma etiqueta de escassez ("Oferta de Lançamento: X/50 vagas restantes").

| Produto | Preço | Inclui |
| --- | --- | --- |
| **Vitalício de lançamento** | R$ 30, pagamento único | Até 1.000 leads no total e até 10 buscas por dia |
| **Pacote de Créditos Extra** | R$ 15 | +1.000 leads, não expira |

**Planos mensais.** Quando as 50 vendas são atingidas, a área de preços muda sozinha para os planos mensais (Pix ou cartão, cada pagamento libera 30 dias, sem fidelidade):

| Plano | Preço | Leads por mês | Buscas por dia |
| --- | --- | --- | --- |
| **Básico** | R$ 29,90 | até 1.000 | 20 |
| **Pro** (mais popular) | R$ 59,90 | até 4.500 | 40 |
| **Business** | R$ 149,90 | ilimitado, com trava interna de uso justo (30.000/mês) | 100 |

Os preços, limites e cotas ficam no servidor (`lib/plan.ts`), então o cliente não consegue alterá-los.

### Casos de uso

- **Agência de tráfego pago:** buscar "clínicas de estética" em 5 cidades, exportar o XLSX e enviar proposta por WhatsApp para quem não tem site.
- **SDR de software B2B:** montar listas de "escritórios de contabilidade" por região com e-mail e telefone para cadência de cold call.
- **Freelancer de sites:** listar empresas locais sem site (campo de site vazio) e oferecer criação de página.
- **Franquia ou expansão:** mapear a concorrência e a densidade de um nicho por cidade.

### Segurança

- Sessão por cookie assinado, **um dispositivo por vez**, expiração por inatividade de 30 min e batimento de sessão enquanto a aba está visível.
- Limite de tentativas de login por IP e por e-mail.
- Verificação de origem (*same-origin*) nas rotas que alteram estado.
- Pagamento confirmado **no servidor**, consultando a API do Mercado Pago; o webhook exige assinatura HMAC válida.
- Cota de leads e buscas reservada de forma atômica, sem brecha para burlar login ou pagamento pelo cliente.
- Cabeçalhos de segurança (CSP, HSTS, `X-Frame-Options`, etc.) em `next.config.mjs`.
- Enriquecimento com proteção básica contra SSRF (bloqueia hosts internos).

---

## 4. Instalação local e execução

**Pré-requisitos:** Node.js 20 ou superior e npm.

```bash
git clone https://github.com/PresetyX/LeadHunter.git
cd LeadHunter

npm install
cp .env.example .env.local     # preencha as variáveis (veja a seção 5)

npm run dev                    # http://localhost:3000
```

Outros comandos:

```bash
npm test          # testes automatizados (normalização, dedupe, cotas, pagamentos, trava da Google)
npm run build     # build de produção
npm start         # serve o build de produção
```

> **Sem credenciais?** Para testar a interface localmente sem Blob nem Postgres, defina `LEADHUNTER_TEST_MEMORY_STORE=1` (armazenamento em memória, apenas fora da Vercel). Sem `PLACES_API_KEY`, a busca usa o OpenStreetMap.

### Deploy na Vercel

```bash
npm i -g vercel
vercel --prod
```

Cadastre as variáveis de ambiente em *Settings > Environment Variables* do projeto (marque segredos como **Sensitive**). Variáveis só valem em deploys novos, então faça um novo deploy depois de criá-las ou alterá-las.

---

## 5. Variáveis de ambiente

Copie `.env.example` para `.env.local` (desenvolvimento) ou cadastre as mesmas chaves na Vercel (produção). **Nunca faça commit de chaves reais.**

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `AUTH_SECRET` | sim | Segredo das sessões. Gere com `openssl rand -base64 48`. |
| `BLOB_READ_WRITE_TOKEN` | uma das duas | Token do Vercel Blob, usado para usuários, cache e contador de chamadas. |
| `DATABASE_URL` | uma das duas | Alternativa ao Blob: Postgres (Neon). |
| `MP_ACCESS_TOKEN` | sim | Access token do Mercado Pago (Checkout Pro). |
| `MP_WEBHOOK_SECRET` | sim | Segredo para validar a assinatura do webhook do Mercado Pago. |
| `PLACES_API_KEY` | recomendada | Chave da Google Cloud Places API (New). Sem ela a busca cai no OpenStreetMap. Restrinja a chave à Places API. |
| `PLACES_MONTHLY_CALL_CAP` | não | Teto global de chamadas ao Google por mês (padrão `900`). |
| `GOOGLE_MAX_CALLS_PER_SEARCH` | não | Teto de chamadas ao Google por busca (padrão `18`). |
| `SCRAPER_API_KEY` | não | Chave do Outscraper, usado só se o Google não trouxer resultados. |
| `OUTSCRAPER_QUERY_VARIANTS` | não | Quantidade de sinônimos do nicho por busca no Outscraper (1 a 3). |
| `NEXT_PUBLIC_APP_URL` | não | URL pública do app (retornos de pagamento e webhook). Na Vercel é inferida. |
| `PRICING_MODE` | não | `auto` (padrão: vitalício enquanto vendas < 50), `launch` ou `monthly`. |
| `ADMIN_EMAILS` | não | E-mails (separados por vírgula) que veem o `dev-toggle` de preços. |
| `PRICING_DEV_TOGGLE` | não | `1` mostra o seletor para todos. Evite em produção. |

`PLACES_API_KEY` também aceita o nome antigo `GOOGLE_PLACES_API_KEY`.

### Custos da Google Places API

A busca pede telefone e site, o que cai na faixa **Enterprise** da Google: **1.000 chamadas grátis por mês** e depois cerca de **US$ 35 a cada 1.000**. Cada busca consome de 3 a 18 chamadas. Por isso o projeto tem a trava `PLACES_MONTHLY_CALL_CAP` e o cache de 7 dias. Recomenda-se também criar um **alerta de orçamento** no Google Cloud e restringir a chave à Places API. Confira os preços atuais na documentação da Google antes de aumentar o teto.

---

## Uso responsável

Os dados vêm de fontes públicas e de APIs oficiais. Para prospecção, respeite a **LGPD** (base legal de legítimo interesse e opção fácil de descadastro) e os termos de uso das fontes. Nominatim e Overpass são serviços comunitários: evite buscas em massa.
