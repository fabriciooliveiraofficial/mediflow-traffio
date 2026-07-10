/**
 * Script para executar chamadas de teste na Meta Graph API v21.0.
 * Registra o uso das permissões necessárias para o App Review da Meta.
 * 
 * Como executar:
 *   deno run -A test-meta-permissions.ts
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

console.log("=== INICIANDO TESTE DE PERMISSÕES DA META ===");
console.log("Para obter esses dados, conecte o Facebook no Traffio e copie os valores salvos na tabela 'tenant_meta_pages'.");

const pageAccessToken = prompt("Digite o PAGE_ACCESS_TOKEN:")?.trim();
const pageId = prompt("Digite o PAGE_ID:")?.trim();
const instagramAccountId = prompt("Digite o INSTAGRAM_ACCOUNT_ID (opcional, aperte Enter se não houver):")?.trim();

if (!pageAccessToken || !pageId) {
  console.error("ERRO: PAGE_ACCESS_TOKEN e PAGE_ID são obrigatórios!");
  Deno.exit(1);
}

async function makeRequest(url: string, description: string, permissionTested: string) {
  console.log(`\n--------------------------------------------`);
  console.log(`[Testando: ${permissionTested}]`);
  console.log(`Executando: ${description}...`);
  try {
    const res = await fetch(url);
    const status = res.status;
    const data = await res.json();

    if (res.ok) {
      console.log(`✓ SUCESSO (Status ${status})`);
      console.log("Resposta (resumo):", JSON.stringify(data, null, 2).substring(0, 300) + "...");
    } else {
      console.warn(`⚠ AVISO/ERRO DA META (Status ${status}):`);
      console.warn(JSON.stringify(data, null, 2));
    }
  } catch (err: any) {
    console.error(`✗ ERRO DE CONEXÃO:`, err.message);
  }
}

// 1. Testar public_profile e pages_show_list
await makeRequest(
  `${GRAPH_API}/me?fields=id,name&access_token=${pageAccessToken}`,
  "Obtendo informações básicas do perfil (/me)",
  "public_profile, pages_show_list"
);

// 2. Testar pages_manage_ads (Criar e gerenciar anúncios / Capturar Leads)
await makeRequest(
  `${GRAPH_API}/${pageId}/ads?limit=1&access_token=${pageAccessToken}`,
  `Obtendo anúncios da página (${pageId}/ads)`,
  "pages_manage_ads"
);

await makeRequest(
  `${GRAPH_API}/${pageId}/leadgen_forms?limit=1&access_token=${pageAccessToken}`,
  `Obtendo formulários de leads da página (${pageId}/leadgen_forms)`,
  "pages_manage_ads"
);

// Se houver conta do Instagram, testar as permissões de Instagram
if (instagramAccountId) {
  // 3. Testar instagram_business_manage_messages e instagram_business_basic
  await makeRequest(
    `${GRAPH_API}/${instagramAccountId}/conversations?limit=1&access_token=${pageAccessToken}`,
    `Obtendo conversas do Instagram (${instagramAccountId}/conversations)`,
    "instagram_business_manage_messages, instagram_business_basic"
  );

  // 4. Testar instagram_manage_comments
  console.log(`\n--------------------------------------------`);
  console.log(`[Testando: instagram_manage_comments]`);
  console.log(`Buscando mídias do Instagram para encontrar posts para teste...`);
  
  try {
    const mediaRes = await fetch(`${GRAPH_API}/${instagramAccountId}/media?limit=3&access_token=${pageAccessToken}`);
    const mediaData = await mediaRes.json();
    
    if (mediaRes.ok && mediaData.data && mediaData.data.length > 0) {
      const mediaId = mediaData.data[0].id;
      console.log(`✓ Mídia encontrada: ID ${mediaId}`);
      
      await makeRequest(
        `${GRAPH_API}/${mediaId}/comments?limit=1&access_token=${pageAccessToken}`,
        `Buscando comentários do post ${mediaId}`,
        "instagram_manage_comments"
      );
    } else {
      console.warn("⚠ Nenhuma publicação encontrada no Instagram.");
      console.warn("Dica: Você precisa ter pelo menos um post na conta do Instagram Business do teste para que possamos testar comentários.");
      console.warn("Tentando chamada genérica para forçar detecção de escopo...");
      
      await makeRequest(
        `${GRAPH_API}/${instagramAccountId}/media?fields=comments&access_token=${pageAccessToken}`,
        `Buscando campo de comentários na conta do Instagram`,
        "instagram_manage_comments"
      );
    }
  } catch (err: any) {
    console.error(`✗ Falha ao testar comentários do Instagram:`, err.message);
  }
} else {
  console.log("\n[Instagram Ignorado]: INSTAGRAM_ACCOUNT_ID não foi fornecido.");
}

console.log("\n============================================");
console.log("Testes finalizados!");
console.log("Aguarde alguns minutos e atualize o painel da Meta for Developers para ver os resultados.");
