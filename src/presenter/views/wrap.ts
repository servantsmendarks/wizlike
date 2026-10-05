// UI-43 / UI-46（M7）: 長い文を折り返して出す所の共通の折り返し。DOM に触れない（style に Object.assign するだけの値）。
// 禁則はブラウザの line-break: strict に任せる（句読点・閉じ括弧・！？…・ー・小書きの仮名、半角の ) ] ! ? , . などを行頭に置かない。
// 開き括弧を行末に置かない）。word-break は normal（仮名・漢字は normal でも 1 字ずつ折り返せるので break-all は要らない）にし、
// 折り返せない長い半角の語だけ overflow-wrap: anywhere で字の途中で折る。
// style.css の creation-intro / creation-error / settings-notice / settings-install も同じ値にする。
export const WRAP_STYLE = {
  whiteSpace: "pre-wrap",
  wordBreak: "normal",
  lineBreak: "strict",
  overflowWrap: "anywhere",
} as const;
