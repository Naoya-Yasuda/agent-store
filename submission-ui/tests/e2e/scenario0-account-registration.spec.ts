import { test, expect } from '@playwright/test';

/**
 * シナリオ0: 企業アカウント登録と認証のテスト
 *
 * テスト仕様書: docs/MANUAL_TESTING_GUIDE.md
 * Step 0-1 ~ 0-6 をカバー
 */
test.describe('シナリオ0: 企業アカウント登録と認証', () => {
  const testOrgName = `テスト株式会社_${Date.now()}`;
  const testContactEmail = `contact_${Date.now()}@test-company.jp`;
  const testWebsite = 'https://test-company.jp';
  const testUserEmail = `user_${Date.now()}@test-company.jp`;
  const testPassword = 'SecurePass123!';

  test('Step 0-1: Submission UIのホームページを開く', async ({ page }) => {
    await page.goto('/');

    // ページタイトルを確認
    await expect(page).toHaveTitle(/Agent Hub/);

    // 「エージェントを登録する」リンクが表示される
    const registerLink = page.getByRole('link', { name: 'エージェントを登録する' });
    await expect(registerLink).toBeVisible();

    // 「ログイン」リンクが表示される
    const loginLink = page.getByRole('link', { name: 'ログイン' });
    await expect(loginLink).toBeVisible();
  });

  test('Step 0-2: 企業アカウント登録ページを開く', async ({ page }) => {
    await page.goto('/');

    // 「ログイン」リンクをクリック
    await page.getByRole('link', { name: 'ログイン' }).click();

    // ログインページに遷移
    await expect(page).toHaveURL(/\/login/);

    // 「新規登録」リンクをクリック
    await page.getByRole('link', { name: '新規登録' }).click();

    // 企業アカウント登録ページに遷移
    await expect(page).toHaveURL(/\/register-account/);

    // ページタイトルを確認
    await expect(page.getByRole('heading', { name: '企業アカウント登録' })).toBeVisible();
  });

  test('Step 0-3 & 0-4: 企業情報とユーザー情報を入力してアカウント作成', async ({ page }) => {
    await page.goto('/register-account');

    // 組織情報セクションに入力（IDベースのセレクタを使用）
    await page.fill('#organizationName', testOrgName);
    await page.fill('#contactEmail', testContactEmail);
    await page.fill('#website', testWebsite);

    // ユーザーアカウント情報セクションに入力
    await page.fill('#email', testUserEmail);
    await page.fill('#password', testPassword);
    await page.fill('#confirmPassword', testPassword);

    // APIリクエストを監視（Auth Serviceは3003ポート）
    const registerRequestPromise = page.waitForResponse(
      (response) => {
        const url = response.url();
        return (url.includes('localhost:3003') || url.includes('localhost:3001')) &&
               url.includes('/auth/register') &&
               response.status() === 200;
      }
    );

    // 「アカウントを作成」ボタンをクリック
    await page.getByRole('button', { name: 'アカウントを作成' }).click();

    // APIリクエストが送信されることを確認
    const registerResponse = await registerRequestPromise;
    expect(registerResponse.ok()).toBeTruthy();

    // レスポンスにaccessTokenとrefreshTokenが含まれることを確認
    const responseBody = await registerResponse.json();
    expect(responseBody).toHaveProperty('accessToken');
    expect(responseBody).toHaveProperty('refreshToken');
    expect(responseBody).toHaveProperty('user');

    // ホームページにリダイレクトされることを確認
    await expect(page).toHaveURL('/');

    // localStorageにトークンが保存されていることを確認
    const accessToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('refreshToken'));
    const user = await page.evaluate(() => localStorage.getItem('user'));

    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(user).toBeTruthy();

    // ユーザー情報が正しく保存されていることを確認
    const userData = JSON.parse(user!);
    expect(userData.email).toBe(testUserEmail);
    expect(userData.organizationId).toBeTruthy();
  });

  test('Step 0-5: バリデーションエラーの確認', async ({ page }) => {
    await page.goto('/register-account');

    // 空の状態で「アカウントを作成」ボタンをクリック
    await page.getByRole('button', { name: 'アカウントを作成' }).click();

    // バリデーションエラーメッセージが表示されることを確認
    await expect(page.getByText('組織名を入力してください')).toBeVisible();
    await expect(page.getByText('連絡先メールアドレスを入力してください')).toBeVisible();
    await expect(page.getByText('メールアドレスを入力してください')).toBeVisible();
    await expect(page.getByText('パスワードを入力してください')).toBeVisible();
    await expect(page.getByText('パスワード（確認）を入力してください')).toBeVisible();
  });

  test('Step 0-6: ログアウトとログイン', async ({ page }) => {
    // まずアカウントを作成
    await page.goto('/register-account');
    await page.fill('#organizationName', testOrgName);
    await page.fill('#contactEmail', testContactEmail);
    await page.fill('#email', testUserEmail);
    await page.fill('#password', testPassword);
    await page.fill('#confirmPassword', testPassword);

    const registerResponse = await page.waitForResponse(
      (response) => {
        const url = response.url();
        return (url.includes('localhost:3003') || url.includes('localhost:3001')) &&
               url.includes('/auth/register') &&
               response.status() === 200;
      }
    );
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await registerResponse;
    await expect(page).toHaveURL('/');

    // localStorageをクリア（ログアウト）
    await page.evaluate(() => localStorage.clear());

    // ページをリロード
    await page.reload();

    // ログインページにリダイレクトされるか、ログインリンクが表示されることを確認
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      await expect(page).toHaveURL(/\/login/);
    } else {
      // ホームページの場合はログインリンクをクリック
      await page.getByRole('link', { name: 'ログイン' }).click();
    }

    // ログイン情報を入力（IDベースのセレクタを使用）
    await page.fill('#email', testUserEmail);
    await page.fill('#password', testPassword);

    // ログインAPIリクエストを監視
    const loginRequestPromise = page.waitForResponse(
      (response) => {
        const url = response.url();
        return (url.includes('localhost:3003') || url.includes('localhost:3001')) &&
               url.includes('/auth/login') &&
               response.status() === 200;
      }
    );

    // 「ログイン」ボタンをクリック
    await page.getByRole('button', { name: 'ログイン' }).click();

    // APIリクエストが送信されることを確認
    const loginResponse = await loginRequestPromise;
    expect(loginResponse.ok()).toBeTruthy();

    // レスポンスにaccessTokenとrefreshTokenが含まれることを確認
    const responseBody = await loginResponse.json();
    expect(responseBody).toHaveProperty('accessToken');
    expect(responseBody).toHaveProperty('refreshToken');

    // ホームページにリダイレクトされることを確認
    await expect(page).toHaveURL('/');

    // localStorageに再びトークンが保存されていることを確認
    const accessToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(accessToken).toBeTruthy();
  });
});
