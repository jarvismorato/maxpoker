# Dossiê técnico do MAXpoker

Atualizado em 17 de novembro de 2026 · Versão 1.3.0

## Objetivo e escopo

Aplicação de Texas Hold'em No-Limit com fichas virtuais, jogadores humanos e bots.
Esta documentação descreve o código local. A URL histórica de hospedagem é
https://maxpoker.onrender.com; esta revisão não confirma o estado do deploy nem publica alterações.
Repositório informado: https://github.com/jarvismorato/maxpoker.

## Arquitetura

- Node.js e módulos nativos http, fs, path e crypto.
- WebSocket com a biblioteca ws; mensagens JSON e limite de 16 KiB por mensagem.
- Interface HTML, CSS e JavaScript sem etapa de build; sons pela Web Audio API.
- accounts.json para contas, saldos e reserva recuperável das fichas na mesa.
- Mesas, baralho, temporizadores e tokens de sessão em memória de um único processo.
- HTTPS/WSS depende do proxy/hospedagem. É proteção de transporte; não é criptografia ponta a ponta entre jogadores.
- O script iniciar-cloudflare.ps1 é uma opção de túnel local, não uma dependência obrigatória da aplicação.

## Arquivos

```text
server.js              Servidor, contas, regras e bots
public/index.html      Login, lobby, mesa e modais
public/style.css       Estilos e adaptação para telas pequenas
public/client.js       WebSocket, interface, sons e ações
accounts.json          Dados das contas; não usar em testes
package.json           Versão, dependências e comandos
package-lock.json      Versões de instalação
README.md              Guia rápido
test/poker.test.js     Testes isolados de regras e ciclo de vida
```

## Regras implementadas

Mesas de até seis jogadores; blinds fixos de 100/200. O dealer gira entre participantes.
Em heads-up, o dealer posta o small blind e age primeiro no preflop.
O big blind mantém a opção de agir depois dos calls; postar blind não conta como ação voluntária.

Cada jogador recebe duas cartas. Há queima antes do flop, turn e river.
O avaliador escolhe a melhor combinação de cinco entre as sete cartas, incluindo sequência A-2-3-4-5,
desempates e empates. O embaralhamento usa Fisher-Yates com crypto.randomInt.
Isso não constitui uma prova pública de distribuição nem uma auditoria independente de justiça.

As ações aceitas são fold, check, call e raise. O servidor valida turno, participação, saldo,
inteiros seguros, aumento mínimo e direito de reabrir apostas. Um aumento all-in abaixo do mínimo
não reabre automaticamente a ação de quem já agiu. Aumentos curtos acumulados podem reabrir a ação
quando atingem o aumento mínimo em relação à última ação do participante.

A contribuição total de cada jogador determina o pote principal e os potes laterais.
Jogadores que deram fold não concorrem a vitórias. Excesso sem disputa pode ser devolvido;
isto é restituição, não prêmio. Sobras inteiras em empates seguem a ordem à esquerda do dealer.
Quando ninguém mais precisa agir, o board avança automaticamente até o showdown.

O prazo humano é de 30 segundos: check se não há valor a pagar; caso contrário, fold.
A entrada é recusada durante a mão; o jogador pode tentar novamente no intervalo entre mãos.
Não há recompra automática de humanos. Jogadores sem fichas retornam ao lobby ao final da mão.
Bots sem fichas recebem o buy-in padrão na preparação da próxima mão.

## Contas, fichas e recuperação

Contas novas recebem 50.000 fichas; bônus de 10.000 com intervalo obrigatório de quatro horas,
independentemente do saldo. A configuração histórica de cadastro do nome Gabriel mantém o
valor inicial especial de 100 bilhões, mas login e reinício não redefinem um saldo já existente.
A aplicação não cria automaticamente uma conta com senha conhecida.

O buy-in deve ser um inteiro dentro dos limites da mesa e do saldo disponível. Para mesas novas,
o mínimo é 2.000, o máximo deve ser pelo menos o mínimo e até 1 bilhão; o padrão deve estar nessa faixa.

Cada snapshot inclui a carteira e tableEscrow, que representa stack e contribuições ainda não liquidadas.
O arquivo é gravado primeiro em .tmp e depois renomeado. Ao reiniciar, a reserva é creditada uma única vez,
a mão interrompida é cancelada e as sessões precisam de novo login. Não é uma retomada da mão antiga.
Dados malformados interrompem a inicialização para impedir substituição silenciosa de contas.

Na saída voluntária, o stack retorna à carteira e a mão é abandonada; contribuições permanecem
contabilizadas para os potes. Uma desconexão mantém identidade e assento por 30 segundos.
A autenticação no período transfere o assento para a nova conexão. O relógio de ação continua correndo.
Conexões simultâneas da mesma conta são recusadas. Logout invalida os tokens daquela conta.

## Interface e protocolo

Mensagens principais do cliente: register, login, tokenAuth, logout, claimBonus, createRoom,
joinRoom, sit, action e leaveRoom. O servidor responde com init, authSuccess, authError,
tokenExpired, loggedOut, lobbyUpdate, joinedRoom, tableUpdate, accountUpdate, leftRoom e alert.

Cartas adversárias ficam ocultas antes do showdown. Cartas descartadas por fold não são reveladas.
Nomes de mesas, jogadores, avatares e rótulos de ação usam textContent na interface.
Os blinds exibidos vêm de campos próprios, não do tamanho do último aumento.
O slider aceita fichas inteiras, incluindo o valor exato de all-in.
Há aviso de reconexão, controles de aposta desabilitados durante a queda e estilos para telas pequenas.

## Bots

Os bots seguem heurísticas simples por categoria da mão e escolhas aleatórias, não um solver.
Dificuldades aceitas: easy, medium e hard. Velocidades: slow, normal e fast.
Tempos de decisão: lento 2,4–3,4 s; normal 1,8–2,6 s; rápido 0,9–1,3 s.
Uma tentativa de aumento impossível é convertida em call, evitando travamento de um bot sem stack suficiente.

## Operação, testes e limites

Na pasta do projeto, execute npm ci e npm start; padrão http://localhost:3000.
PORT escolhe a porta; ACCOUNTS_FILE escolhe o caminho dos dados. npm test executa testes isolados
com temporizadores controlados, sem acessar contas reais.

A cobertura inclui valores inválidos, opção do big blind, all-in, potes laterais, fichas restantes,
entrada durante mão, reinício, reconexão, saída e decisões de bots com pouco stack.

Use um volume persistente na hospedagem e backups externos. Um arquivo JSON não fornece coordenação
entre múltiplos processos. Tokens não sobrevivem a reinícios. As senhas existentes usam SHA-256 com salt;
uma migração para uma função dedicada de derivação de senhas permanece uma melhoria de segurança.
Não há comprovação de prontidão para dinheiro real, auditoria de segurança completa nem teste de carga
nesta revisão. Os testes descritos verificam cenários concretos, não todas as combinações possíveis.
