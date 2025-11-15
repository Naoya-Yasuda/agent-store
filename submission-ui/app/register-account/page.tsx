'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterAccountPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    // Organization info
    organizationName: '',
    website: '',

    // User info
    email: '',
    password: '',
    confirmPassword: '',

    // Contact info
    contactEmail: '',
  });

  const [validationErrors, setValidationErrors] = useState({
    organizationName: '',
    website: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactEmail: '',
  });

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateUrl = (url: string): boolean => {
    if (!url) return true; // website is optional
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const validatePassword = (password: string): boolean => {
    return password.length >= 8;
  };

  const validateField = (name: string, value: string) => {
    let errorMessage = '';

    switch (name) {
      case 'organizationName':
        if (!value.trim()) {
          errorMessage = '組織名を入力してください';
        } else if (value.trim().length < 2) {
          errorMessage = '組織名は2文字以上である必要があります';
        }
        break;

      case 'website':
        if (value && !validateUrl(value)) {
          errorMessage = '有効なURLを入力してください（例: https://example.com）';
        }
        break;

      case 'email':
        if (!value.trim()) {
          errorMessage = 'メールアドレスを入力してください';
        } else if (!validateEmail(value)) {
          errorMessage = '有効なメールアドレスを入力してください';
        }
        break;

      case 'password':
        if (!value) {
          errorMessage = 'パスワードを入力してください';
        } else if (!validatePassword(value)) {
          errorMessage = 'パスワードは8文字以上である必要があります';
        }
        break;

      case 'confirmPassword':
        if (!value) {
          errorMessage = 'パスワード（確認）を入力してください';
        } else if (value !== formData.password) {
          errorMessage = 'パスワードが一致しません';
        }
        break;

      case 'contactEmail':
        if (!value.trim()) {
          errorMessage = '連絡先メールアドレスを入力してください';
        } else if (!validateEmail(value)) {
          errorMessage = '有効なメールアドレスを入力してください';
        }
        break;
    }

    setValidationErrors(prev => ({ ...prev, [name]: errorMessage }));
    return errorMessage === '';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);

    // Re-validate confirmPassword if password changes
    if (name === 'password' && formData.confirmPassword) {
      validateField('confirmPassword', formData.confirmPassword);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate all fields
    const orgNameValid = validateField('organizationName', formData.organizationName);
    const websiteValid = validateField('website', formData.website);
    const emailValid = validateField('email', formData.email);
    const passwordValid = validateField('password', formData.password);
    const confirmPasswordValid = validateField('confirmPassword', formData.confirmPassword);
    const contactEmailValid = validateField('contactEmail', formData.contactEmail);

    if (!orgNameValid || !websiteValid || !emailValid || !passwordValid || !confirmPasswordValid || !contactEmailValid) {
      setError('入力内容にエラーがあります。修正してください。');
      return;
    }

    setIsSubmitting(true);

    try {
      const authUrl = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:3001';

      const response = await fetch(`${authUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization: {
            name: formData.organizationName,
            contact_email: formData.contactEmail,
            website: formData.website || undefined,
          },
          user: {
            email: formData.email,
            password: formData.password,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'アカウント登録に失敗しました' }));
        throw new Error(errorData.error || `サーバーエラー: ${response.status}`);
      }

      const data = await response.json();

      // Store tokens and user info
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Redirect to home page
      router.push('/');
    } catch (err) {
      console.error('Registration error:', err);
      setError(err instanceof Error ? err.message : 'アカウント登録に失敗しました。もう一度お試しください。');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/login" className="text-blue-600 hover:underline text-sm">
            ← ログインページに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            企業アカウント登録
          </h1>
          <p className="text-gray-600 mb-8">
            AIエージェントを登録するには、まず企業アカウントが必要です。
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Organization Information Section */}
              <div className="border-b border-gray-200 pb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  組織情報
                </h2>

                {/* Organization Name */}
                <div className="mb-4">
                  <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 mb-2">
                    組織名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="organizationName"
                    name="organizationName"
                    value={formData.organizationName}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.organizationName ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="株式会社Example"
                  />
                  {validationErrors.organizationName && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.organizationName}</p>
                  )}
                </div>

                {/* Contact Email */}
                <div className="mb-4">
                  <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700 mb-2">
                    組織の連絡先メールアドレス <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="contactEmail"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.contactEmail ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="contact@example.com"
                  />
                  {validationErrors.contactEmail && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.contactEmail}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    エージェントに関する重要な通知の送信先
                  </p>
                </div>

                {/* Website (Optional) */}
                <div>
                  <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-2">
                    Webサイト（オプション）
                  </label>
                  <input
                    type="url"
                    id="website"
                    name="website"
                    value={formData.website}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.website ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="https://example.com"
                  />
                  {validationErrors.website && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.website}</p>
                  )}
                </div>
              </div>

              {/* User Account Section */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  ユーザーアカウント情報
                </h2>

                {/* Email */}
                <div className="mb-4">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    ログイン用メールアドレス <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="user@example.com"
                  />
                  {validationErrors.email && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div className="mb-4">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    パスワード <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.password ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="••••••••"
                  />
                  {validationErrors.password && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.password}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    8文字以上のパスワードを設定してください
                  </p>
                </div>

                {/* Confirm Password */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    パスワード（確認） <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    style={{ color: '#111827' }}
                    className={`w-full px-4 py-2 border rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationErrors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="••••••••"
                  />
                  {validationErrors.confirmPassword && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.confirmPassword}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex-1 py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                  isSubmitting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isSubmitting ? '登録中...' : 'アカウントを作成'}
              </button>
              <Link
                href="/login"
                className="px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors text-center"
              >
                キャンセル
              </Link>
            </div>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            <p>
              すでにアカウントをお持ちの方は
              <Link href="/login" className="text-blue-600 hover:underline ml-1">
                ログイン
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            登録後にできること
          </h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>AIエージェントの登録と管理</li>
            <li>信頼性評価の進捗確認</li>
            <li>評価結果とスコアの閲覧</li>
            <li>承認されたエージェントの公開</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
