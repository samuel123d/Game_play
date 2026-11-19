export const GAME_QUESTIONS = [
  {
    prompt: "Um formulário pede CPF, foto do documento e nome da mãe para baixar um folheto gratuito. Qual é o melhor próximo passo?",
    choices: [
      "Preencher: todo cadastro pede esses dados",
      "Parar e confirmar se os dados são realmente necessários",
      "Inventar um CPF e enviar a foto"
    ],
    answer: 1,
    explanation: "Peça apenas os dados necessários. Um pedido excessivo é motivo para pausar e confirmar quem está coletando as informações."
  },
  {
    prompt: "Você encontra um cadastro por um anúncio e o endereço tem uma letra diferente do site que conhece. O que fazer?",
    choices: [
      "Conferir pelo aplicativo ou endereço oficial que você já conhece",
      "Continuar se houver um cadeado no navegador",
      "Entrar com a mesma senha usada no banco"
    ],
    answer: 0,
    explanation: "Um cadeado indica uma conexão criptografada, não que o site seja legítimo. Confira o endereço por um canal confiável."
  },
  {
    prompt: "Ao preencher um endereço, você percebe que digitou um número errado. Antes de continuar:",
    choices: [
      "Enviar mesmo assim para não perder o formulário",
      "Revisar o campo e corrigir usando informação confirmada",
      "Usar o endereço de outra pessoa"
    ],
    answer: 1,
    explanation: "Confira cada campo antes de avançar. Dados incorretos podem impedir contato ou causar problemas no cadastro."
  },
  {
    prompt: "Um formulário pede um código que chegou por SMS para “confirmar sua identidade”. Qual cuidado é essencial?",
    choices: [
      "Compartilhar o código com quem estiver ajudando por mensagem",
      "Digitar o código apenas no serviço oficial que você abriu",
      "Enviar uma captura da tela para o suporte"
    ],
    answer: 1,
    explanation: "Códigos de uso único são secretos. Não os envie a outra pessoa nem compartilhe por telefone ou mensagem."
  },
  {
    prompt: "O site diz que o cadastro é gratuito, mas uma tela inesperada pede dados do cartão para liberar uma conta básica. Você deve:",
    choices: [
      "Parar e verificar a oferta e o endereço por um canal oficial",
      "Preencher: o cadeado garante que é seguro",
      "Tentar com o cartão de um familiar"
    ],
    answer: 0,
    explanation: "Uma conexão segura não prova que a cobrança é legítima. Confirme se o serviço e a cobrança correspondem ao que você pretendia."
  },
  {
    prompt: "Você usou um computador compartilhado para preencher um cadastro. O que fazer ao terminar?",
    choices: [
      "Salvar a senha no navegador para a próxima pessoa",
      "Sair da conta e não salvar senha nem documentos",
      "Deixar o formulário aberto para voltar depois"
    ],
    answer: 1,
    explanation: "Em aparelhos compartilhados, encerre a sessão e evite salvar senhas ou deixar documentos e páginas abertas."
  },
  {
    prompt: "Um formulário de inscrição em um curso pede uma senha. Qual opção reduz o risco se o site tiver um problema?",
    choices: [
      "Repetir a senha do e-mail para não esquecer",
      "Criar uma senha longa e exclusiva para esse serviço",
      "Usar nome e data de nascimento"
    ],
    answer: 1,
    explanation: "Uma senha única impede que a exposição de uma conta abra automaticamente as outras."
  },
  {
    prompt: "Antes de tocar em “Enviar cadastro”, qual revisão é mais segura?",
    choices: [
      "Conferir endereço do site, dados digitados e finalidade dos campos",
      "Verificar apenas se todos os campos estão preenchidos",
      "Enviar rápido e corrigir depois por um link recebido"
    ],
    answer: 0,
    explanation: "Confira se está no serviço certo, se os dados estão corretos e se os campos pedidos fazem sentido antes de enviar."
  }
];
