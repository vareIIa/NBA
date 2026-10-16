# Responsividade — primeira etapa (2026-10-16)

Implementado na versão `web`:

- LS com zona morta radial de 18%, amplitude contínua e direção preservada.
- Frenagem ao reduzir ou inverter o comando; a aceleração da arrancada e os impulsos dos dribles foram preservados.
- Giro pelo menor ângulo, incluindo inversão exata de 180°.
- LS e RT do quadro atual disponíveis antes de iniciar o drible.

Validação:

- `npm test`: inclui 13 testes novos de entrada e movimento.
- `npm run build`: TypeScript e produção.
- `npm run e2e -- e2e/movement.spec.ts`: giro, escape com RT no mesmo update e crossover andando, a 30/60/120/144 Hz; os quatro passaram.
- Roteiro completo existente de dribles e arremessos: três execuções instrumentadas consecutivas passaram. A conexão de HMR foi isolada nas páginas de teste para evitar recargas por outras sessões.

Ocorrência pendente: uma execução completa anterior registrou distância horizontal bola–jogador de 1,54 m, acima do limite de 1,30 m. As três execuções seguintes ficaram em 0,94–0,95 m; uma comparação com as fórmulas anteriores ficou em 0,94 m. Não houve alteração do limite nem confirmação da causa. Não tratar a repetição bem-sucedida como correção dessa ocorrência.

Esta etapa não altera a sincronização entre o relógio do controlador, a pausa do clipe esperando a bola e o arco do drible. Esse desacoplamento continua sendo o próximo ponto estrutural a investigar. Os testes não comprovam qualidade visual equivalente ao NBA 2K.
