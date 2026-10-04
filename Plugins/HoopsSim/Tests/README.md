# Testes do núcleo HoopsSimCore

O núcleo de simulação (`Plugins/HoopsSim/Source/HoopsSimCore`) é C++20 puro. Ele roda dentro da Unreal (módulo `HoopsSimCore`) e também fora dela, para testes rápidos.

```bash
cmake -S Plugins/HoopsSim/Tests -B build/tests -DCMAKE_BUILD_TYPE=Release
cmake --build build/tests -j
./build/tests/hoops_tests        # Windows: build\tests\Release\hoops_tests.exe
```

O build usa as mesmas restrições da Unreal (sem exceções/RTTI, `-Wshadow -Wconversion -Werror`), para o código que passa aqui também compilar na engine.

| Teste | O que garante |
|---|---|
| FloorBounceMatchesFibaRule | Quique da bola na madeira dentro da regra da FIBA |
| HoopGeometryIsRegulation | Aro a 3,05 m, borda interna a 0,151 m da tabela, tabela a 2,90 m |
| StraightDropThroughCenterIsSwish / DropOnRimEdgeTouchesRim | Detecção de cesta e contato com o aro |
| FastBallDoesNotTunnelThroughBackboard | Bola a 25 m/s não atravessa a tabela |
| ThreePointLineClassification | Linha de 3 (arco e canto) |
| ShotProbabilityMatchesDesignTable | Números do exemplo de `docs/03-arremessos.md §3.2` |
| TimingWindowScalesAndFloor / TimingGradeBoundaries | Janelas (rating, tipo, velocidade, fadiga, sem medidor, piso de 17 ms) |
| DecisionRateMatchesProbability | Sorteio bate com a probabilidade (20.000 amostras) |
| EarlyMissesTendShortLateMissesTendLong | Cedo → curto, tarde → longo |
| GreenOpenAlwaysGoesInPhysically | Green livre entra na física de qualquer posição (2–8,5 m) |
| RealizedOutcomeMatchesDecision | A física realiza a decisão em ≥ 99% (hoje 100%) e erros tocam aro/tabela |
| MakeEntryAngleIsRealistic | Ângulo de entrada de um 3PT entre 42° e 50° |
| RealizationIsDeterministic | Mesma semente → mesma trajetória |
| DribbleArcHitsHandAndFloorExactly | Drible chega na mão exata no tempo exato, sem atravessar o chão |
| StickDirectionsAndMirror | 8 direções do Pro Stick e espelhamento para a mão esquerda |
| StickFlickHoldRotationRecognized | Toque, segurar/soltar, giro e quarto de círculo |
| StickDoubleThrowAndSwitchback | Gestos de combo do 2K23 (e que flicks lentos não viram combo) |
| GesturesMapToTwoKMoves | Gesto → movimento igual ao manual do 2K23 (com troca de mão) |
| DribbleControllerCommitBufferAndRhythm | Commit, buffer de 150 ms, combo no ritmo (+15% de velocidade) |
| ExplosionsAndEnergy | 3 Explosões por posse, energia gasta no sprint e recuperada parado |
| LayupAndDunkProbabilities | Bandeja livre ~91% (rating 85); enterrada livre garantida |
| RollingBallComesToRest | Bola rolando no chão para (resistência ao rolamento) |
