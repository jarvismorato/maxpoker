# Login Google

O login usa Google Identity Services e `google-auth-library`. Configure `GOOGLE_CLIENT_ID` no Render com o ID de um cliente OAuth do tipo **Aplicativo da Web**. Não é necessário Client Secret.

Nas origens JavaScript autorizadas do cliente Google, inclua `https://maxpoker.onrender.com` e cada domínio próprio usado pelo site. Para desenvolvimento, autorize `http://localhost` e `http://localhost:3110`. O fluxo usa callback JavaScript; não há URI de redirecionamento.

Configure o nome MAXpoker, o contato de suporte e o público no Google Auth Platform. Em modo de teste, adicione os usuários de teste; para uso público, conclua a publicação exigida pelo Google. Sem `GOOGLE_CLIENT_ID`, o login tradicional continua disponível e o botão Google fica oculto.

## Contas existentes

Entre com usuário e senha, clique no nome e use **Acesso com Google** para vincular a identidade à conta atual. A vinculação mantém saldo e histórico. Entrar pela primeira vez com Google sem vincular cria uma conta separada com 50.000 fichas. Nomes e e-mails iguais não mesclam contas automaticamente.

O servidor valida assinatura, audiência, emissor, validade e nonce associado à conexão. Apenas o `sub` verificado identifica o vínculo. A consulta ao Google ocorre fora da fila de persistência para não bloquear as mãos; a alteração da conta é serializada e confirmada no PostgreSQL antes da resposta de sucesso. Tokens Google não são armazenados.

Referências: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token e https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
