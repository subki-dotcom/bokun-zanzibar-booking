export const normalizeQuestionScope = (value = "") => {
  const token = String(value || "booking").toLowerCase();
  if (token.includes("pickup")) return "pickup";
  if (token.includes("dropoff")) return "dropoff";
  if (token.includes("passenger") || token.includes("participant")) return "passenger";
  return "booking";
};

export const answerFromCustomer = (question = {}, customer = {}) => {
  const token = `${question.label || ""} ${question.help || ""} ${question.placeholder || ""}`.toLowerCase();

  if (/pickup|hotel|accommodation|meeting point/.test(token)) return customer.hotelName;
  if (/first\s*name|given\s*name/.test(token)) return customer.firstName;
  if (/last\s*name|family\s*name|surname/.test(token)) return customer.lastName;
  if (/full\s*name|customer\s*name/.test(token)) return [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  if (/e-?mail/.test(token)) return customer.email;
  if (/phone|mobile|whatsapp|telephone/.test(token)) return customer.phone;
  if (/country|nationality/.test(token)) return customer.country;
  if (/special request|comment|note/.test(token)) return customer.notes;

  return "";
};

export const isCustomerManagedQuestion = (question = {}) => {
  const token = `${question.label || ""} ${question.help || ""} ${question.placeholder || ""}`.toLowerCase();
  return /pickup|hotel|accommodation|meeting point|first\s*name|given\s*name|last\s*name|family\s*name|surname|full\s*name|customer\s*name|e-?mail|phone|mobile|whatsapp|telephone|country|nationality|special request|comment|note/.test(token);
};

export const isSystemManagedQuestion = (question = {}) => {
  const questionId = String(question.questionId || question.id || "").trim().toLowerCase();
  return questionId === "sendnotificationtomaincontact";
};

export const findQuestionAnswer = (answers = [], question = {}) =>
  (Array.isArray(answers) ? answers : []).find(
    (answer = {}) =>
      String(answer.questionId || "") === String(question.questionId || question.id || "") &&
      normalizeQuestionScope(answer.scope) === normalizeQuestionScope(question.scope)
  );

export const getMissingRequiredQuestionLabels = ({ questions = [], answers = [], customer = {} } = {}) =>
  (Array.isArray(questions) ? questions : [])
    .filter((question) => question?.required && normalizeQuestionScope(question.scope) !== "passenger")
    .filter((question) => !isSystemManagedQuestion(question))
    .filter((question) => {
      const value = isCustomerManagedQuestion(question)
        ? answerFromCustomer(question, customer)
        : findQuestionAnswer(answers, question)?.answer;
      return Array.isArray(value) ? value.length === 0 : !String(value || "").trim();
    })
    .map((question) => question.label || "Required tour information")
    .filter((label, index, all) => all.indexOf(label) === index);
