export const GAME_QUESTIONS = [
  {
    prompt: "Segundo a apresentação, o que caracteriza a verdadeira Inclusão Digital?",
    choices: [
      "Possuir um smartphone moderno com plano de internet móvel ilimitado.",
      "Garantir que todas as pessoas acessem e usem a tecnologia de forma consciente, segura e útil.",
      "Saber programar aplicativos e configurar redes sem fio em casa."
    ],
    answer: 1,
    explanation:
      "Inclusão digital significa permitir que qualquer pessoa, em qualquer idade, acesse e utilize a tecnologia com consciência, segurança e utilidade no dia a dia."
  },
  {
    prompt: "Na aula sobre acessibilidade, vimos três ferramentas inclusivas. Qual delas faz leitura de tela por voz para pessoas com deficiência visual?",
    choices: [
      "VLibras",
      "Autime",
      "TalkBack"
    ],
    answer: 2,
    explanation:
      "O TalkBack narra o que aparece na tela para pessoas com deficiência visual. O VLibras traduz conteúdos para Libras e o Autime apoia rotinas visuais."
  },
  {
    prompt: "Qual é a principal diferença entre um navegador (Chrome ou Safari) e um aplicativo específico (como gov.br ou iFood)?",
    choices: [
      "O navegador acessa sites diversos na web; o aplicativo é criado para uma função específica no celular.",
      "O navegador funciona apenas sem internet, enquanto os aplicativos exigem rede Wi-Fi.",
      "Aplicativos servem apenas para lazer, e navegadores são exclusivos para serviços do governo."
    ],
    answer: 0,
    explanation:
      "Navegadores permitem pesquisar e abrir páginas variadas na internet, enquanto cada aplicativo é desenvolvido para executar uma tarefa específica."
  },
  {
    prompt: "Conhecendo seu celular: qual recurso continua funcionando mesmo quando o aparelho está totalmente sem internet?",
    choices: [
      "Fazer chamada de vídeo pelo WhatsApp e consultar a previsão do tempo atualizada.",
      "Fazer ligações telefônicas tradicionais pela operadora e usar a câmera para fotografar.",
      "Realizar transferências via PIX e assistir a filmes em aplicativos de streaming."
    ],
    answer: 1,
    explanation:
      "Ligações telefônicas comuns usam o sinal da operadora e a câmera funciona offline; já WhatsApp, PIX e streaming dependem de conexão com a internet."
  },
  {
    prompt: "⚡ RODADA EM DOBRO: O que diferencia o golpe com Deepfake de outras fraudes digitais comuns?",
    choices: [
      "Ele invade automaticamente a conta bancária assim que a vítima abre uma mensagem de texto.",
      "Usa inteligência artificial para clonar rostos, expressões e vozes, inclusive em videochamadas ao vivo.",
      "Consiste apenas no envio de mensagens de cobrança com erros de português e links falsos."
    ],
    answer: 1,
    explanation:
      "O Deepfake usa inteligência artificial para manipular rostos e vozes com extremo realismo — até mesmo ao vivo durante uma videochamada.",
    doublePoints: true
  },
  {
    prompt: "No Phishing, criminosos imitam bancos ou órgãos oficiais. Além de roubar senhas e dinheiro, que outro risco direto foi destacado?",
    choices: [
      "Instalar vírus no celular ou no computador ao clicar em links maliciosos.",
      "Cancelar automaticamente o CPF da vítima junto à plataforma gov.br.",
      "Clonar a voz da vítima durante ligações telefônicas convencionais."
    ],
    answer: 0,
    explanation:
      "Ao clicar em links de Phishing, além de entregar dados e senhas, o usuário corre o risco de instalar vírus no celular ou computador."
  },
  {
    prompt: "Sobre a Lei Felca (ECA Digital) aplicada aos jogos online, qual conjunto de regras e prazo foi definido para as desenvolvedoras?",
    choices: [
      "Prazo até 2030 para liberar anúncios comerciais direcionados ao público infantil.",
      "Prazo até 2027 para exigir verificação de idade, controle parental e proibir loot boxes pagas para menores.",
      "Proibição imediata de qualquer jogo online gratuito para menores de 18 anos já em 2026."
    ],
    answer: 1,
    explanation:
      "A Lei Felca (ECA Digital) dá prazo até 2027 para as empresas adotarem verificação rigorosa de idade, controle parental e vetarem loot boxes pagas e anúncios abusivos para menores."
  },
  {
    prompt: "Qual gatilho psicológico os golpistas mais exploram em mensagens suspeitas para impedir que a vítima verifique a informação?",
    choices: [
      "Curiosidade sobre atualizações gratuitas do sistema operacional do aparelho.",
      "Medo e senso de urgência, como ameaças de bloqueio imediato da conta ou perda de prazo.",
      "Convites formais para responder a pesquisas longas de satisfação sem recompensa."
    ],
    answer: 1,
    explanation:
      "Mensagens fraudulentas tentam provocar medo ou pressa com ameaças de bloqueio imediato para levar a vítima a clicar sem conferir."
  },
  {
    prompt: "Mesmo criando uma senha forte com letras, números e símbolos, qual hábito compromete totalmente essa proteção?",
    choices: [
      "Usar senhas diferentes para o e-mail pessoal e para o aplicativo do banco.",
      "Memorizar a senha sem precisar anotá-la na capa do celular.",
      "Enviar a senha em conversas do WhatsApp ou anotá-la em locais visíveis."
    ],
    answer: 2,
    explanation:
      "Uma senha forte perde a segurança se for anotada em locais visíveis ou compartilhada em mensagens pelo WhatsApp."
  },
  {
    prompt: "⚡ DESAFIO FINAL: Você recebe uma videochamada rápida de um parente pedindo PIX urgente por troca de chip, seguida de um link 'do banco'. Qual análise está correta?",
    choices: [
      "Como houve videochamada com o rosto e a voz do parente, o pedido é real, bastando ignorar apenas o link.",
      "É um golpe combinado de Deepfake e Phishing: deve-se desligar, ligar para o número antigo do parente e não clicar no link.",
      "Deve-se responder na mesma conversa pedindo o CPF do parente para confirmar a identidade antes de clicar no link."
    ],
    answer: 1,
    explanation:
      "Criminosos já combinam Deepfake em chamadas com links de Phishing. Nunca confirme dados na mesma conversa suspeita: desligue e ligue para o contato original."
    ,
    doublePoints: true
  }
];