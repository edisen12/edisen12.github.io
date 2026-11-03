# Arquitetura de Abstração Universal de Persistência

> **HH Offshore · Infotec Brasil**  
> Guia Técnico de Arquitetura, Topologias de Persistência e Deploy VPS Corporativo  
> *Data: Novembro/2026 · Versão: 2.0*

---

## 1. A Regra de Ouro das Duas Topologias (`baas` vs `self-hosted`)

O sistema HH Offshore adota o modelo arquitetural de **Dual-Topology com Registry Aberto**, projetado para suportar desde implantações serverless de custo zero até infraestruturas corporativas estritamente controladas em servidores próprios (VPS, clusters on-premise ou nuvens privadas).

As duas topologias são **mutuamente exclusivas** e operam com modelos de segurança radicalmente distintos:

```mermaid
flowchart TD
    subgraph Topologia1["Topologia 1: baas (Custo $0 / GitHub Pages)"]
        SPA1["Frontend SPA Estática<br/>(GitHub Pages / CDN)"]
        SDK1["BaaS Connector Port<br/>(Supabase / Firebase / Appwrite)"]
        CloudBaaS["Nuvem Provedor BaaS<br/>(PostgreSQL com RLS / Auth / Realtime)"]
        
        SPA1 --> SDK1
        SDK1 -- "HTTPS / WSS Direto (Anon Key)" --> CloudBaaS
    end

    subgraph Topologia2["Topologia 2: self-hosted (VPS Corporativa / Docker)"]
        Nginx["Nginx Hardened<br/>(Reverse Proxy, Static Assets, SSE)"]
        Backend["Servidor Privado Node.js 22<br/>(API REST, Stateful Auth, Universal Storage Driver)"]
        DB["Banco de Dados Puro<br/>(PostgreSQL, MariaDB, MySQL, MongoDB, Oracle, etc.)"]
        
        ClientBrowser["Navegador Corporativo"] -- "HTTP / HTTPS (:80 / :443)" --> Nginx
        Nginx -- "Proxy /api/v1/ (frontend-net)" --> Backend
        Backend -- "Driver Nativo / TCP (backend-net interna)" --> DB
    end
```

### 1.1 Comparativo de Características

| Dimensão | Topologia 1: `baas` | Topologia 2: `self-hosted` |
|---|---|---|
| **Cenário de Uso** | Hospedagem estática pública (GitHub Pages) | Servidor próprio VPS, On-Premise, Cloud Corporativa |
| **Custo de Infraestrutura** | $0 (free-tier no Supabase/Firebase) | Custo da máquina virtual (VPS) |
| **Exposição de Rede** | Browser fala diretamente com a API do BaaS | Browser fala **apenas** com Nginx (`/` e `/api/v1/`) |
| **Segurança do Banco** | RLS (Row Level Security) nativo do BaaS | Rede Docker interna (`internal: true`), zero portas no host |
| **Autenticação / Sessão** | Tokens JWT gerenciados pelo SDK do BaaS | Cookies stateful `HttpOnly; SameSite=Strict; Secure` + CSRF |
| **Bancos Suportados** | Provedores BaaS (Supabase, Firebase, PocketBase) | **Qualquer** banco (Postgres, MariaDB, Mongo, Oracle, etc.) |

### 1.2 As 4 Travas Automáticas de Segurança do Build

Para impedir erros operacionais, vazamento de credenciais ou violação do modelo de segurança, o pipeline de compilação impõe 4 travas automáticas:

```mermaid
flowchart LR
    T1["1. Trava de Configuração<br/>(VITE_TOPOLOGY estrito)"] --> T2["2. Trava Anti-PureDB<br/>(Proíbe banco puro em BaaS)"]
    T2 --> T3["3. Trava de Bundle Audit<br/>(closeBundle zero-leak)"]
    T3 --> T4["4. Trava de Transporte<br/>(Cookie HttpOnly + CSRF)"]
```

1. **Trava de Validação Estrita de Topologia (`VITE_TOPOLOGY`):**
   A variável de ambiente `VITE_TOPOLOGY` deve conter exclusivamente o valor literais `'baas'` ou `'self-hosted'`. Qualquer outro valor (ou ausência da variável em builds produtivos) interrompe a compilação com erro impeditivo no console.

2. **Trava de Proibição de Banco Puro na Topologia BaaS:**
   Tentativas de configurar connection strings diretas de bancos SQL/NoSQL (PostgreSQL TCP, MariaDB, MongoDB) na Topologia `baas` são sumariamente bloqueadas. O navegador jamais deve receber drivers de banco ou credenciais de banco relacional sem uma camada de backend intermediária.

3. **Trava de Auditoria de Bundle (`closeBundle()`):**
   Durante a compilação em modo `self-hosted`, o plugin de auditoria do Vite inspeciona os chunks gerados no diretório `dist/`. Se detectar menções ao SDK `@supabase/supabase-js`, URLs `.supabase.co` ou chaves anon no código compilado da SPA, o build é abortado com código de saída 1. O frontend `self-hosted` consome exclusivamente a rota `/api/v1/`.

4. **Trava de Transporte Seguro e Zero-Storage:**
   Na Topologia `self-hosted`, nenhum token de acesso é gravado em `localStorage` ou `sessionStorage`. O estado de autenticação é mantido via Cookie `HttpOnly` emitido pelo servidor e validado via token anti-CSRF duplo em cabeçalho `X-CSRF-Token`, eliminando completamente o risco de exfiltração de credenciais via XSS.

---

## 2. Como Trocar de BaaS na Topologia 1 (`VITE_TOPOLOGY=baas`)

Na Topologia `baas`, a aplicação consome a porta `BaaSConnectorPort`. Para alternar de provedor (por exemplo, do Supabase padrão para PocketBase, Appwrite ou Firebase), é necessário **apenas criar um arquivo implementando a interface** e registrá-lo no catálogo.

### 2.1 Interface `BaaSConnectorPort`

A porta define os contratos mínimos que o provedor BaaS deve fornecer para atender às regras de negócio do HH Offshore:

```typescript
export interface BaaSConnectorPort {
  readonly providerName: string;
  
  // Módulo de Autenticação e Sessão
  auth: {
    signIn(credentials: { email: string; password: string }): Promise<AuthSessionResult>;
    signOut(): Promise<void>;
    getCurrentSession(): Promise<UserSession | null>;
    onAuthStateChange(callback: (session: UserSession | null) => void): () => void;
    changePassword(newPassword: string): Promise<void>;
  };

  // Módulo de Dados e Persistência
  data: {
    fetchScopeDataset(queryWindow: { start: string; end: string }): Promise<AppDataset>;
    saveJustificativa(payload: JustificativaInput): Promise<JustificativaOutput>;
    batchImportHH(rows: ApontamentoRow[], onProgress: (done: number, total: number) => void): Promise<ImportSummary>;
    savePlatform(platform: PlatformInput): Promise<void>;
    savePerson(person: PersonInput): Promise<void>;
    fetchAuditLogs(filter: AuditFilter): Promise<AuditLogEntry[]>;
    healthCheck(): Promise<boolean>;
  };

  // Módulo de Atualizações em Tempo Real (Opcional/Degradável)
  realtime?: {
    subscribeJustificativas(onChange: () => void): () => void;
    subscribeHeartbeat(onTick: () => void): () => void;
  };
}
```

### 2.2 Exemplo de Conector BaaS Alternativo (PocketBase)

Abaixo, um mini-exemplo conciso demonstrando a facilidade de implementação de um conector alternativo (ex: `src/services/connectors/pocketbase.connector.ts`):

```typescript
import { BaaSConnectorPort } from '../contracts/baas.port';
import { registerBaaSConnector } from '../contracts/baas.registry';

export class PocketBaseConnector implements BaaSConnectorPort {
  readonly providerName = 'pocketbase';
  private pbUrl: string;

  constructor() {
    this.pbUrl = import.meta.env.VITE_POCKETBASE_URL || 'https://pocketbase.exemplo.com';
  }

  auth = {
    async signIn({ email, password }) {
      const res = await fetch(`${this.pbUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password })
      });
      if (!res.ok) throw new Error('Credenciais inválidas no PocketBase');
      const data = await res.json();
      return { user: { id: data.record.id, email: data.record.email, role: data.record.role } };
    },
    async signOut() { /* limpa sessão local */ },
    async getCurrentSession() { return null; },
    onAuthStateChange(cb) { return () => {}; },
    async changePassword(newPassword: string) { /* chamada de patch */ }
  };

  data = {
    async fetchScopeDataset(window) {
      // Carrega apontamentos, técnicos e plataformas via API REST do PocketBase
      const res = await fetch(`${this.pbUrl}/api/collections/apontamentos/records?filter=data>='${window.start}'`);
      const items = await res.json();
      return { /* mapeia para AppDataset */ } as any;
    },
    async saveJustificativa(payload) { /* upsert na coleção justificativas */ return {} as any; },
    async batchImportHH(rows, onProgress) { /* chunks de 500 no PocketBase */ return {} as any; },
    async savePlatform(pl) { /* upsert plataformas */ },
    async savePerson(pe) { /* upsert pessoas */ },
    async fetchAuditLogs(f) { return []; },
    async healthCheck() {
      const r = await fetch(`${this.pbUrl}/api/health`);
      return r.ok;
    }
  };
}

// Registro automático da porta
registerBaaSConnector('pocketbase', () => new PocketBaseConnector());
```

### 2.3 Ativação no `.env`

Para ativar o novo conector sem tocar no código central da aplicação:

```env
# Ativa topologia BaaS
VITE_TOPOLOGY=baas

# Seleciona o conector registrado
VITE_BAAS_PROVIDER=pocketbase
VITE_POCKETBASE_URL=https://pocketbase.interno.infotec.com.br

# Domínios externos liberados no CSP dinâmico do Vite/index.html
VITE_BAAS_CONNECT_ORIGINS=https://pocketbase.interno.infotec.com.br wss://pocketbase.interno.infotec.com.br
```

---

## 3. Como Trocar para QUALQUER Banco Puro na Topologia 2 (`VITE_TOPOLOGY=self-hosted`)

Na Topologia `self-hosted`, o frontend não sabe e não precisa saber qual banco de dados armazena os registros. O servidor `backend/` implementa a porta `UniversalStorageDriverPort`.

### 3.1 As 7 Primitivas da `UniversalStorageDriverPort`

Toda persistência do sistema é encapsulada em 7 operações atômicas:

```typescript
export interface UniversalStorageDriverPort {
  readonly driverName: string;

  // 1. Conexão e Inicialização
  initialize(connectionUri: string): Promise<void>;
  
  // 2. Healthcheck e Conectividade
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;

  // 3. Leitura Completa do Dataset do Escopo do Usuário
  fetchScopeDataset(params: {
    userId: string;
    role: string;
    allowedPlatforms: string[];
    queryStart: string;
    queryEnd: string;
  }): Promise<AppDataset>;

  // 4. Gravação de Justificativa com SLA
  saveJustificativa(justificativa: JustificativaRecord, authorUserId: string): Promise<void>;

  // 5. Ingestão de Apontamentos de HH em Lote (Chunks anti-deadlock)
  batchImportHH(
    rows: ApontamentoRecord[],
    importContext: { importId: string; userEmail: string },
    onProgress?: (saved: number, total: number) => void
  ): Promise<{ inserted: number; updated: number }>;

  // 6. Gestão de Pessoas, Plataformas e Escopos
  savePlatform(platform: PlatformRecord): Promise<void>;
  savePerson(person: PersonRecord, scopePlatforms: string[]): Promise<void>;

  // 7. Auditoria Imutável (WORM)
  logAuditEvent(entry: AuditEventInput): Promise<void>;
  fetchAuditLogs(filter: AuditFilter): Promise<AuditLogEntry[]>;
}
```

### 3.2 Como Plugar Qualquer Banco SQL em ~15 Linhas (`GenericSqlDialectDriver`)

Graças à classe base `GenericSqlDialectDriver`, plugar bancos relacionais como PostgreSQL, MariaDB, MySQL, SQLite, Microsoft SQL Server, Oracle ou CockroachDB requer apenas declarar os adaptadores de dialeto (placeholders de parâmetros e cláusula de upsert):

```typescript
import { GenericSqlDialectDriver, registerStorageDriver } from './universal-storage.registry.js';
import mariadb from 'mariadb'; // ou mysql2, oracledb, mssql, pg

export class MariaDbStorageDriver extends GenericSqlDialectDriver {
  readonly driverName = 'mariadb';
  private pool!: mariadb.Pool;

  protected async executeQuery(sql: string, params: any[]) {
    return this.pool.query(sql, params);
  }

  // Dialetos específicos em linhas únicas:
  protected getPlaceholder(index: number): string { return '?'; } // '?' no MariaDB vs '$1' no Postgres
  protected getUpsertSuffix(keys: string[], updateCols: string[]): string {
    return `ON DUPLICATE KEY UPDATE ` + updateCols.map(c => `${c}=VALUES(${c})`).join(', ');
  }

  async initialize(connectionUri: string) {
    this.pool = mariadb.createPool(connectionUri);
    await this.healthCheck();
  }
}

// Registro no catálogo do backend
registerStorageDriver('mariadb', () => new MariaDbStorageDriver());
```

### 3.3 Como Plugar Qualquer Banco NoSQL / Documentos em ~20 Linhas (`GenericDocumentDriver`)

Para bancos orientados a documentos como MongoDB, CouchDB, Amazon DynamoDB ou SurrealDB, a classe `GenericDocumentDriver` mapeia as entidades em 7 coleções:

```typescript
import { GenericDocumentDriver, registerStorageDriver } from './universal-storage.registry.js';
import { MongoClient, Db } from 'mongodb';

export class MongoDbStorageDriver extends GenericDocumentDriver {
  readonly driverName = 'mongodb';
  private db!: Db;

  async initialize(connectionUri: string) {
    const client = new MongoClient(connectionUri);
    await client.connect();
    this.db = client.db();
  }

  protected async findDocuments(collection: string, query: Record<string, any>) {
    return this.db.collection(collection).find(query).toArray();
  }

  protected async upsertDocument(collection: string, filter: Record<string, any>, doc: any) {
    await this.db.collection(collection).updateOne(filter, { $set: doc }, { upsert: true });
  }

  protected async bulkUpsertDocuments(collection: string, docs: Array<{ filter: any; doc: any }>) {
    const ops = docs.map(d => ({ updateOne: { filter: d.filter, update: { $set: d.doc }, upsert: true } }));
    await this.db.collection(collection).bulkWrite(ops, { ordered: true });
  }
}

registerStorageDriver('mongodb', () => new MongoDbStorageDriver());
```

### 3.4 Carregando um Driver Externo sem Editar Código (`DB_DRIVER_MODULE`)

Se a infraestrutura da empresa exigir um banco proprietário ou legado (ex: Oracle Corporativo da Intranet com biblioteca cliente fechada), **não é necessário modificar nenhum arquivo do repositório**.

1. Crie o arquivo do driver em qualquer diretório da VPS:
   `/opt/hh-offshore/meu-oracle-driver.mjs`
2. Configure as variáveis no `.env.vps`:
   ```env
   DB_DRIVER=meu-oracle
   DB_DRIVER_MODULE=/opt/hh-offshore/meu-oracle-driver.mjs
   DATABASE_URL=oracle://hhoff_user:SENHA@oracle-cluster:1521/ORCLPDB1
   ```
3. O servidor `backend/` detecta `DB_DRIVER_MODULE` no boot, executa `await import(process.env.DB_DRIVER_MODULE)` dinamicamente e registra o driver no catálogo de armazenamento.

---

## 4. Checklist de Migração e Deploy na VPS

Siga este procedimento passo a passo para implantar o sistema em ambiente corporativo.

### Passo 1: Preparação da VPS

Certifique-se de que a máquina virtual atende aos requisitos mínimos:
- **SO:** Ubuntu Server 22.04 LTS / 24.04 LTS, Debian 12 ou RHEL 9.
- **Hardware:** Mínimo 2 vCPUs, 2 GB de RAM, 20 GB de SSD.
- **Software:** Docker Engine 24+ e Docker Compose v2 instalados.
- **Firewall:** Portas 80 e 443 liberadas para entrada. **Todas as portas de banco (5432, 3306, 27017) bloqueadas externamente.**

### Passo 2: Clonagem do Repositório

```bash
git clone https://github.com/edisen12/edisen12.github.io.git /opt/hh-offshore
cd /opt/hh-offshore
```

### Passo 3: Configuração do Arquivo `.env.vps`

Copie o template de exemplo e preencha as variáveis corporativas:

```bash
cp .env.vps.example .env.vps
chmod 600 .env.vps
nano .env.vps
```

Itens obrigatórios a verificar:
- [ ] `HTTP_PORT=80` (ou porta customizada).
- [ ] `COOKIE_SECURE=true` (defina `true` ao utilizar certificado SSL/TLS).
- [ ] `BOOTSTRAP_ADMIN_EMAIL=admin.seu-escopo@infotecbrasil.com.br`.
- [ ] `BOOTSTRAP_ADMIN_PASSWORD`: gere uma senha forte (`openssl rand -base64 24`).
- [ ] `DB_DRIVER`: escolha `postgres`, `mariadb` ou `mongodb`.
- [ ] `DATABASE_URL`: aponte para o container do Docker Compose ou para o banco corporativo externo.
- [ ] `DB_PASSWORD`: configure uma senha forte para o container de banco interno.

### Passo 4: Subindo a Stack com Docker Compose

Inicie a aplicação utilizando o profile correspondente ao banco selecionado:

```bash
# Exemplo 1: Com PostgreSQL 17 isolado
docker compose --env-file .env.vps --profile postgres up -d --build

# Exemplo 2: Com MariaDB 11.4 isolado
docker compose --env-file .env.vps --profile mariadb up -d --build

# Exemplo 3: Com MongoDB 7.0 isolado
docker compose --env-file .env.vps --profile mongodb up -d --build

# Exemplo 4: Com Banco Externo (RDS / On-Premise) - Sem container de banco local
docker compose --env-file .env.vps up -d --build
```

### Passo 5: Verificação Pós-Deploy e Auditoria de Segurança

Execute os testes de validação em linha de comando na VPS:

1. **Checagem de Saúde da API:**
   ```bash
   curl -I http://127.0.0.1/api/v1/health
   # Resposta esperada: HTTP/1.1 200 OK
   ```

2. **Auditoria de Isolamento de Portas de Banco:**
   ```bash
   netstat -tlpn | grep -E '(5432|3306|27017|3000)'
   # Nenhuma linha deve ser retornada! O host não escuta nestas portas.
   ```

3. **Verificação dos Cookies de Segurança (`HttpOnly`, `SameSite=Strict`):**
   ```bash
   curl -i -X POST http://127.0.0.1/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@infotecbrasil.com.br","password":"SUA_SENHA_CONFIGURADA"}'
   # Verifique no cabeçalho de resposta:
   # Set-Cookie: hhoff_session=...; HttpOnly; SameSite=Strict; Path=/
   ```

4. **Auditoria de Bundle Zero-Leak:**
   ```bash
   docker exec hh-offshore-nginx grep -rn "supabase" /usr/share/nginx/html/assets/ || echo "AUDITORIA APROVADA: Zero referências ao Supabase no bundle compilado!"
   ```

5. **Acompanhamento de Logs dos Containers:**
   ```bash
   docker compose logs -f backend
   ```

---

## 5. Resumo das Decisões e Conformidade Forense

- **Repositório Público Seguro:** Nenhum segredo, senha ou token corporativo reside em arquivos versionados do repositório.
- **Preservação do Domínio:** Toda a lógica de regras contratuais (`src/domain/`) permanece inalterada e agnóstica a bancos e provedores de infraestrutura.
- **Total Flexibilidade:** A transição entre nuvem pública sem servidor e VPS on-premise ocorre de maneira nativa, suportando qualquer SGDB moderno sem retrabalho no código da aplicação.
