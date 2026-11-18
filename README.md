# MAXpoker

Texas Hold'em com fichas virtuais, contas locais, mesas de seis lugares e bots.
Versão 1.5.0.

## Executar

Requer Node.js 18 ou superior e npm. Na pasta do projeto:

```powershell
npm ci
npm start
```

Abra http://localhost:3000. A variável PORT permite escolher outra porta.

## Testar

```powershell
npm test
```

Os testes usam contas e temporizadores isolados: não modificam accounts.json.
Para executar manualmente com contas de teste:

```powershell
$env:ACCOUNTS_FILE = Join-Path $env:TEMP 'maxpoker-test-accounts.json'
$env:PORT = '3107'
npm start
```

## Comportamento

- Cadastro: 50.000 fichas; bônus: 10.000 a cada quatro horas.
- Blinds fixos: 100/200. Mesas personalizadas exigem buy-in mínimo de 2.000.
- Entrada durante a mão como espectador, com vaga reservada para a próxima mão e débito apenas ao sentar.
- All-ins, potes laterais e divisão de fichas inteiras; raise mínimo validado pelo servidor.
- Turno humano: 30 segundos, seguido de check quando possível ou fold.
- Desconexão: reserva de 30 segundos para recuperar o mesmo assento.
- Sem recompra automática: ao ficar sem fichas, o jogador volta ao lobby.
- Reinício: a mão interrompida é cancelada; stack e contribuição ainda pendente são restituídos.

## Banco persistente em produção

Configure DATABASE_URL no ambiente do Render com uma conexão PostgreSQL.
O servidor no Render recusa iniciar sem essa variável, para impedir novas contas no disco temporário.
A senha de conexão deve ficar apenas nas variáveis do serviço; nunca no Git ou no JavaScript do navegador.

O esquema é criado automaticamente no banco. A tabela maxpoker_state mantém um snapshot JSONB
atômico de contas, carteiras e reservas das mesas, com revisão para impedir sobrescrita por um processo antigo.
Cadastros, bônus e ações só são confirmados ao cliente depois da gravação no PostgreSQL.
Uma falha de gravação interrompe o servidor; ele não continua usando um arquivo local como alternativa.

O banco começa vazio por padrão. Para importar um backup existente uma única vez, configure
IMPORT_ACCOUNTS_FILE com o caminho do JSON. A importação só ocorre se o snapshot ainda não existir;
reinícios posteriores ignoram o arquivo. Um banco já inicializado nunca é substituído por esse backup.
Contas que já desapareceram do disco do Render não podem ser recuperadas sem cópia.

Em desenvolvimento local sem DATABASE_URL, accounts.json continua disponível.
ACCOUNTS_FILE permite escolher outro arquivo. Preserve esse arquivo e não use contas reais em testes.

GET /healthz retorna o estado de prontidão e o tipo de armazenamento, sem credenciais.
Para executar também o teste contra um PostgreSQL de teste, defina TEST_DATABASE_URL e rode npm test.
Esse usuário precisa poder criar e remover bancos de teste; não aponte para produção.
O teste cria um banco separado, verifica cadastro, bônus, buy-in e dois reinícios e remove apenas esse banco.

Use um único processo ativo por banco. Durante um deploy, a revisão do snapshot impede o servidor
antigo de sobrescrever dados após o novo assumir. Mesas e tokens permanecem em memória: uma mão
interrompida é cancelada, sua reserva é restituída uma única vez e é necessário fazer login novamente.
Mantenha backups do banco e acompanhe os limites do provedor escolhido.

O servidor local usa HTTP; HTTPS/WSS é fornecido pela hospedagem ou proxy.
Não há pagamentos ou saques de dinheiro real.

Consulte DOSSIE_MAXPOKER.md para regras e limitações.

A conta Gabriel possui carteira ilimitada (∞): o servidor recompõe automaticamente
a reserva mínima de 100 bilhões. Limites das mesas e regras de apostas continuam válidos.

## Mesas e bots — versão 1.5.0

A Mesa de Pessoas não contém bots e começa com dois humanos. O lobby distingue pessoas, bots e reservas.
Bots fáceis pagam 80% das apostas pequenas com mãos fracas e valorizam pares e cartas altas no preflop.
O nível Impossível estima equidade com 80 simulações de cartas desconhecidas e compara com o preço
da aposta. Ele não recebe cartas adversárias nem a ordem real do baralho. É o nível mais forte,
mas não é invencível nem um solver. Há uma mesa Desafio Impossível e a opção ao criar mesas.
