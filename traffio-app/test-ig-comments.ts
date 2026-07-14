import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
await load({ export: true });

const GRAPH_API = "https://graph.facebook.com/v19.0";

async function run() {
  console.log("=== INICIANDO TESTE DE INSTAGRAM_MANAGE_COMMENTS ===");
  
  const pageAccessToken = prompt("Digite o PAGE_ACCESS_TOKEN:");
  if (!pageAccessToken) {
    console.error("Token é obrigatório.");
    Deno.exit(1);
  }

  // 1. Get Page ID and IG Account ID
  const meRes = await fetch(`${GRAPH_API}/me?fields=id,name,instagram_business_account&access_token=${pageAccessToken}`);
  const meData = await meRes.json();
  
  if (!meData.id) {
    console.error("Erro ao validar token:", meData);
    Deno.exit(1);
  }

  const igAccountId = meData.instagram_business_account?.id;
  if (!igAccountId) {
    console.error("Esta página não tem uma conta do Instagram Business vinculada!");
    Deno.exit(1);
  }

  console.log(`\nConta Instagram encontrada: ${igAccountId}`);

  // 2. Fetch Media
  const mediaRes = await fetch(`${GRAPH_API}/${igAccountId}/media?limit=1&access_token=${pageAccessToken}`);
  const mediaData = await mediaRes.json();

  if (!mediaData.data || mediaData.data.length === 0) {
    console.error("\n[ERRO CRÍTICO] Nenhuma publicação encontrada nesta conta do Instagram.");
    console.error("A API do Meta EXIGE que exista pelo menos 1 publicação (foto/vídeo) na conta do Instagram para poder buscar comentários.");
    console.error("Passo a passo:");
    console.error("1. Abra o Instagram no celular.");
    console.error("2. Publique qualquer foto.");
    console.error("3. Rode este script novamente.");
    Deno.exit(1);
  }

  const mediaId = mediaData.data[0].id;
  console.log(`\nPublicação encontrada: ${mediaId}`);

  // 3. Fetch Comments (GET)
  console.log("\nExecutando chamada GET para buscar comentários (valida instagram_manage_comments)...");
  const getCommentsRes = await fetch(`${GRAPH_API}/${mediaId}/comments?access_token=${pageAccessToken}`);
  const getCommentsData = await getCommentsRes.json();
  
  if (getCommentsData.error) {
    console.error("Erro no GET /comments:", getCommentsData.error);
  } else {
    console.log("✓ SUCESSO GET /comments (Status 200)");
    console.log(getCommentsData);
  }

  // 4. Post a Comment (POST)
  console.log("\nExecutando chamada POST para criar comentário (valida instagram_manage_comments fortemente)...");
  const postCommentRes = await fetch(`${GRAPH_API}/${mediaId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Comentário de teste via API Meta (pode ser apagado)',
      access_token: pageAccessToken
    })
  });
  
  const postCommentData = await postCommentRes.json();
  if (postCommentData.error) {
    console.error("Erro no POST /comments:", postCommentData.error);
  } else {
    console.log("✓ SUCESSO POST /comments (Status 200)");
    console.log(`Comentário criado com ID: ${postCommentData.id}`);
    
    // Opcional: Apagar o comentário logo em seguida (DELETE)
    console.log("\nLimpando o comentário de teste (DELETE)...");
    const delRes = await fetch(`${GRAPH_API}/${postCommentData.id}?access_token=${pageAccessToken}`, { method: 'DELETE' });
    const delData = await delRes.json();
    if (delData.success) {
      console.log("✓ Comentário deletado com sucesso!");
    } else {
      console.log("Erro ao deletar:", delData);
    }
  }
  
  console.log("\n=== TESTES CONCLUÍDOS ===");
  console.log("Aguarde alguns minutos e atualize a página de App Review da Meta!");
}

run();
