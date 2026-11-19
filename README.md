# Arcade Pulse v2 — Firebase Firestore (Sem Tela de Login)

Versão atualizada (`v2`) configurada para o projeto Firebase **`gameplay-5ac93`**.

## Novidades da v2
* **Sistema de COMBO (`x1` até `x8`)** e **alvos BÔNUS dourados** (`20` pts base vs `10` pts base).
* **Dificuldade progressiva**: o tempo de cada alvo diminui conforme a pontuação aumenta; se expirar sem clique, o combo volta a `x1`.
* **Destaque visual no placar (`Top 10`)** para as pontuações enviadas na sua sessão atual e persistência do apelido no navegador.
* **`firestore.rules` v2** validando `nickname`, `score`, `maxCombo`, `playerId` e `createdAt == request.time`.

## Como rodar ou publicar
```bash
npx serve .
```
Ou com Firebase CLI:
```bash
firebase deploy --only firestore:rules,hosting
```
