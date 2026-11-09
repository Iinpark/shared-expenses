/**
 * Кто может менять и удалять расход: тот, кто платил (это его деньги), тот, кто внёс расход
 * (мог ошибиться, внося за другого), и создатель группы (как модератор). Остальные видят
 * чужой расход только для чтения. Одно правило для сервера (проверка) и клиента (кнопки).
 */
export function canEditExpense(expense: { payerId: string; createdBy: string }, userId: string, groupOwnerId: string): boolean {
  return userId === expense.payerId || userId === expense.createdBy || userId === groupOwnerId;
}
