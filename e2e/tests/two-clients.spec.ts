import { expect, test } from '@playwright/test';
import { closeDb, groupIdFromUrl, signIn, twoClients } from './helpers.js';

test.afterAll(closeDb);

/**
 * Сквозной сценарий на двух клиентах одновременно: расход у одного — баланс у другого обновляется
 * без перезагрузки; погашение с подтверждением; закрытие группы видно сразу.
 */
test('два участника: расход, погашение с подтверждением, закрытие группы — всё вживую', async ({ browser }) => {
  const { anya, boris } = await twoClients(browser);

  // Аня входит и создаёт группу.
  await anya.goto('/login');
  await signIn(anya, 'anya@example.com', 'Аня');
  await anya.goto('/groups/new');
  await anya.locator('#name').fill('Поездка в Казань');
  await anya.getByRole('button', { name: 'Создать группу' }).click();
  await anya.waitForURL(/\/groups\/[0-9a-f-]{36}/);
  const groupId = groupIdFromUrl(anya);
  const { inviteToken } = await (await anya.request.get(`/api/groups/${groupId}`)).json() as { inviteToken: string };

  // Борис открывает ссылку-приглашение с телефона, входит и вступает.
  await boris.goto(`/j/${inviteToken}`);
  await signIn(boris, 'boris@example.com', 'Борис', 'Присоединиться');
  await boris.waitForURL(new RegExp(`/groups/${groupId}`));
  await boris.goto(`/groups/${groupId}`);
  await expect(boris.getByText('Пока ни одного расхода')).toBeVisible();

  // Аня платит за такси 1 000 на двоих.
  await anya.goto(`/groups/${groupId}/expenses/new`);
  await anya.locator('.amount-input').fill('1000');
  await anya.getByPlaceholder('Например, ужин').fill('Такси');
  await anya.getByRole('button', { name: /^Сохранить/ }).click();
  await anya.waitForURL(new RegExp(`/groups/${groupId}$`));

  // У Бориса без перезагрузки: «С тебя 500,00 ₽» и тост о расходе с его участием.
  await expect(boris.locator('.hero__label')).toHaveText('С тебя');
  await expect(boris.locator('.hero__amount')).toContainText('500,00');
  await expect(boris.getByText(/Аня добавил.*Такси/)).toBeVisible();

  // Борис отмечает перевод всей суммы.
  await boris.getByRole('button', { name: 'Отметить', exact: true }).first().click();
  await boris.getByRole('button', { name: /^Отметить перевод/ }).click();

  // У Ани появляется ожидающее погашение; баланс ещё не изменился.
  await expect(anya.getByRole('button', { name: 'Деньги пришли' })).toBeVisible();
  await expect(anya.locator('.hero__amount').first()).toContainText('500,00');
  await anya.getByRole('button', { name: 'Деньги пришли' }).click();

  // Оба в расчёте — у Бориса тоже без перезагрузки.
  await expect(boris.locator('.hero__label')).toHaveText('Ты в расчёте');
  await expect(anya.locator('.hero__label').first()).toHaveText('Ты в расчёте');

  // Аня закрывает группу — у Бориса сразу баннер и нет кнопки «Расход».
  expect((await anya.request.post(`/api/groups/${groupId}/close`)).status()).toBe(200);
  await expect(boris.getByText(/Группа закрыта/).first()).toBeVisible();
  await expect(boris.getByRole('link', { name: 'Расход', exact: true })).toHaveCount(0);
});
