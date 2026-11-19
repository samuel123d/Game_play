# Desafio Relâmpago · Conexão (Firebase + Vercel)

Versão independente do jogo interativo **Desafio Relâmpago**, conectada ao **Firebase Realtime Database** para funcionar pela internet (sem precisar estar na mesma rede Wi-Fi) e pronta para hospedagem na **Vercel**.

## 1. Configurar o Firebase Realtime Database

1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e abra o projeto **gameplay-5ac93**.
2. No menu lateral, vá em **Criação (Build) → Realtime Database → Criar banco de dados**.
3. Escolha a localização (ex.: `us-central1`), selecione **Iniciar no modo de teste** e clique em **Ativar**.
4. Na aba **Regras (Rules)**, certifique-se de que `rooms` permite leitura e escrita:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

## 2. Publicar na Vercel

1. Envie os arquivos desta pasta para um repositório no **GitHub** (ou importe diretamente pelo CLI `npx vercel --prod`).
2. Na Vercel, mantenha **Framework Preset** como `Other` e **Build Command** vazio.
3. Após o deploy, abra o link gerado pela Vercel no computador/projetor, clique em **Abrir sala do desafio** e peça para os participantes lerem o QR Code pelo celular.
