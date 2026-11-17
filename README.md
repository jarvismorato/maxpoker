# MAXpoker

Texas Hold'em com fichas virtuais, contas locais, mesas de seis lugares e bots.
Versão 1.3.0.

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
- Entrada apenas entre mãos, sem substituir um bot que está jogando.
- All-ins, potes laterais e divisão de fichas inteiras; raise mínimo validado pelo servidor.
- Turno humano: 30 segundos, seguido de check quando possível ou fold.
- Desconexão: reserva de 30 segundos para recuperar o mesmo assento.
- Sem recompra automática: ao ficar sem fichas, o jogador volta ao lobby.
- Reinício: a mão interrompida é cancelada; stack e contribuição ainda pendente são restituídos.

## Dados e operação

accounts.json contém contas e hashes de senha. Preserve o arquivo e mantenha backups.
ACCOUNTS_FILE permite escolher outro caminho, inclusive um volume persistente da hospedagem.
A gravação usa arquivo temporário e renomeação; erros de leitura impedem iniciar com um banco vazio.
Use apenas um processo do servidor por arquivo de contas. Mesas e sessões ficam em memória.
O servidor local usa HTTP; HTTPS/WSS deve ser configurado na hospedagem ou proxy.
Não há pagamentos ou saques de dinheiro real.

Consulte DOSSIE_MAXPOKER.md para arquitetura, regras e limitações.
