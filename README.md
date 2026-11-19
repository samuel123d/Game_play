# Desafio Relâmpago · Conexão (Cloud Firestore + Vercel)

Versão independente do jogo interativo **Desafio Relâmpago**, conectada ao **Cloud Firestore** para funcionar pela internet (sem precisar estar na mesma rede Wi-Fi) e pronta para hospedagem na **Vercel**.

## 1. Atualizar as Regras do Cloud Firestore

1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e abra o projeto **gameplay-5ac93**.
2. No menu lateral, vá em **Criação (Build) → Firestore Database → Regras (Rules)**.
3. Cole o conteúdo do arquivo **`firestore.rules`** (que preserva sua coleção `scores` e adiciona `rooms` e `players`) e clique em **Publicar**.

## 2. Publicar na Vercel

1. Envie os arquivos desta pasta para um repositório no **GitHub** (ou execute `npx vercel --prod` pelo terminal).
2. Na Vercel, mantenha **Framework Preset** como `Other` e **Build Command** vazio.
3. Após o deploy, abra o link gerado pela Vercel no computador/projetor, clique em **Abrir sala do desafio** e peça para os participantes lerem o QR Code pelo celular.
