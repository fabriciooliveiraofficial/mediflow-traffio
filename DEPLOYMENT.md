# Guia de Implantação (Deployment Guide)

Este documento contém os passos necessários para configurar o controle de versão com o **GitHub** e realizar o deploy do frontend no **Cloudflare Pages** com o domínio personalizado `https://mediflow-traffio.com`.

---

## 1. Configuração do Git e Primeiro Push para o GitHub

O repositório local já está inicializado na pasta raiz do projeto. O endereço remoto do GitHub foi configurado como:
`https://github.com/fabriciooliveiraofficial/mediflow-traffio.git`

Para enviar suas alterações para o GitHub, execute os seguintes comandos no terminal:

```bash
# 1. Adicione todas as alterações (arquivos criados e modificados)
git add .

# 2. Faça o commit das alterações
git commit -m "chore: preparar projeto para Cloudflare e GitHub"

# 3. Envie para o branch principal (main)
git push -u origin main
```

---

## 2. Deploy do Frontend no Cloudflare Pages

O Cloudflare Pages conecta-se diretamente ao repositório do GitHub e recompila a aplicação automaticamente a cada novo `git push`.

### Passo a Passo para Conectar o GitHub à Cloudflare:

1. **Acesse o Painel da Cloudflare**:
   * Faça login em [dash.cloudflare.com](https://dash.cloudflare.com/).

2. **Navegue até a Área de Pages**:
   * No menu lateral esquerdo, clique em **Workers & Pages**.
   * Clique no botão **Create application** (Criar aplicativo).
   * Selecione a aba **Pages** na parte superior.
   * Clique no botão **Connect to Git** (Conectar ao Git).

3. **Vincule sua Conta do GitHub**:
   * Clique em **Connect GitHub** (Conectar GitHub).
   * Você será redirecionado para a página de autorização do GitHub.
   * Escolha em qual conta ou organização deseja instalar o aplicativo do Cloudflare Pages.
   * **Recomendação de Segurança**: Na seção *Repository access*, você pode escolher:
     * **Only select repositories** (Apenas repositórios selecionados) e marcar o repositório `fabriciooliveiraofficial/mediflow-traffio`.
     * Ou **All repositories** (Todos os repositórios) para facilitar futuros projetos.
   * Clique em **Install & Authorize** (Instalar e Autorizar) e insira sua senha do GitHub se solicitado.

4. **Selecione o Repositório**:
   * Ao retornar ao painel da Cloudflare, selecione a sua conta do GitHub em *GitHub account*.
   * Selecione o repositório `mediflow-traffio` na lista.
   * Clique em **Begin setup** (Iniciar configuração).

5. **Defina as Configurações de Build**:
   Configure as propriedades do projeto exatamente como abaixo:
   * **Project Name (Nome do projeto):** `mediflow-traffio` (será usado no subdomínio temporário `.pages.dev`)
   * **Production branch (Branch de produção):** `main`
   * **Framework preset (Predefinição do framework):** Selecione **Vite** (ou deixe como *None*)
   * **Root directory (Diretório raiz):** `traffio-app` *(Importante: o código do frontend está nesta subpasta!)*
   * **Build command (Comando de build):** `npm run build`
   * **Build output directory (Diretório de saída):** `dist`

### 4. Configuração das Variáveis de Ambiente (Environment Variables)
Ainda nas configurações do projeto no Cloudflare Pages (ou em *Settings* > *Environment Variables* após a criação), adicione as seguintes chaves com os valores correspondentes obtidos do arquivo `.env.local`:

| Nome da Variável | Valor sugerido (de acordo com as chaves locais) |
| :--- | :--- |
| `VITE_SUPABASE_URL` | `https://fyyhxmugxcfqhvoevuwf.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` *(Chave completa do seu .env.local)* |
| `VITE_GROQ_API_KEY` | *(Sua chave da API do Groq, se usada para o chat de IA)* |

### 5. Configuração do Domínio Personalizado
1. No projeto criado no Cloudflare Pages, vá para a aba **Custom domains**.
2. Clique em **Set up a custom domain**.
3. Insira o domínio: `mediflow-traffio.com` e siga os passos para apontar o DNS (se o seu domínio já estiver na Cloudflare, a configuração do DNS CNAME é feita de forma automática com um clique).

---

## 3. Gerenciamento de Rotas SPA (Single Page Application)

Como o projeto utiliza o `react-router-dom` para navegação interna no navegador (por exemplo: `/login`, `/dashboard`, `/portal/...`), criamos um arquivo chamado `_redirects` na pasta `traffio-app/public/`:

```text
/* /index.html 200
```

Este arquivo instrui o servidor do Cloudflare Pages a redirecionar todas as requisições de URL de volta para o `index.html` com o status `200 OK`. Isso evita erros **404 Not Found** quando o usuário recarrega a página em rotas internas.

---

## 4. Deploy de Banco de Dados e Edge Functions no Supabase (Se necessário)

Se você realizou alterações nas tabelas do banco de dados (migrações) ou nas Edge Functions localizadas em `traffio-app/supabase/`, use a CLI do Supabase para implantá-las no projeto de produção:

```bash
# Navegar até a pasta do app
cd traffio-app

# 1. Fazer login na CLI do Supabase (caso não esteja logado)
npx supabase login

# 2. Vincular a CLI ao seu projeto remoto (use a referência fyyhxmugxcfqhvoevuwf)
npx supabase link --project-ref fyyhxmugxcfqhvoevuwf

# 3. Aplicar as migrações locais pendentes ao banco de dados remoto
npx supabase db push

# 4. Fazer deploy de todas as Edge Functions
npx supabase functions deploy --all
```
