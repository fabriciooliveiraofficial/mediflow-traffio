# Diretrizes de Design & Padronização de Layout (Traffio UI)

Este documento define os padrões visuais e comportamentais para garantir consistência estética de nível Sênior em toda a plataforma. Todas as telas devem seguir estritamente estas diretrizes ao serem criadas ou refatoradas.

---

## 1. Espaçamento Externo (Page Wrapper Padding)

Para manter o mesmo alinhamento de grid e respiro visual em todas as páginas da plataforma:

- **Páginas Padrão (com scroll vertical livre):**
  O container principal de conteúdo deve utilizar o padding:
  ```html
  class="px-6 lg:px-12 py-8"
  ```
- **Páginas Limitadas à Altura da Viewport (ex: Atendimento/Chat, Hub de Comunicações):**
  Devem ocupar toda a altura livre da tela, utilizando flexbox e aplicando padding lateral e inferior para acompanhar o alinhamento da plataforma:
  ```html
  <!-- Em DashboardLayout.tsx -->
  <div className="flex-1 overflow-hidden px-6 lg:px-12 pb-8">
      <!-- O componente da página deve ter h-full w-full -->
  </div>
  ```

---

## 2. Bordas e Divisores (Borders)

Evite o uso de tons escuros de cinza (`border-gray-200` ou `border-slate-200`) e padronize a paleta neutra com a escala `ice`:

- **Divisores e Bordas Principais (Painéis/Cards):**
  Use a borda padrão com tom suave:
  ```html
  border border-ice-100
  ```
- **Filtros e Controles Segmentados (Tabs/Grupos):**
  Use bordas discretamente mais visíveis ou transparentes:
  ```html
  border border-ice-200/60
  ```
- **Bordas Laterais de Painéis Internos (ex: Info de Paciente à direita):**
  ```html
  border-l border-ice-100
  ```

---

## 3. Cantos Arredondados (Border Radius)

A consistência nos arredondados evita a sensação de que diferentes desenvolvedores criaram componentes separados:

- **Contêineres Principais, Painéis Globais de Tela e Modais:**
  Devem usar obrigatoriamente cantos ultra arredondados:
  ```html
  rounded-3xl
  ```
- **Cards Internos, Caixas de Busca e Abas Segmentadas:**
  ```html
  rounded-2xl
  ```
- **Botões Pequenos e Sub-elementos menores:**
  ```html
  rounded-xl
  ```

---

## 4. Sombras (Shadows)

- **Painéis de Conteúdo e Cards Principais:**
  Use sombras discretas para manter o design limpo:
  ```html
  shadow-sm
  ```
- **Modals, Diálogos de Confirmação e Overlays Flutuantes:**
  Use sombras profundas para destacar a hierarquia:
  ```html
  shadow-2xl
  ```

---

## 5. Fundos e Cores Neutras (Backgrounds)

- **Fundo Padrão da Plataforma:** `bg-ice-50` ou `bg-ice-100`.
- **Fundo dos Painéis/Cards Principais:** `bg-white`.
- **Campos de Busca / Inputs Inativos:**
  Substitua o antigo `bg-gray-50` por:
  ```html
  bg-ice-50 border border-ice-100
  ```
- **Controles Segmentados / Wrappers de Abas:**
  ```html
  bg-ice-100 border border-ice-200/60
  ```

---

## 6. Restrição Crucial: Cores de Marca (Brand Colors)

> [!IMPORTANT]
> **NÃO substitua ou remova cores dinâmicas da marca.**
> A plataforma possui um sistema onde o Tenant/Clínica define a sua cor primária (`primary color`).
> - Mantenha as classes que injetam a cor de marca (ex: `bg-brand-primary`, `text-brand-primary`, ou classes dinâmicas geradas no context) intactas.
> - Não substitua classes de cor estáticas específicas de canais (ex: verde do WhatsApp `bg-emerald-600` ou azul do Facebook/Telegram).
