'use client';

import { useEffect, useState } from 'react';

type StageInfo = {
  status: string;
  attempts: number;
  message?: string;
  warnings?: string[];
};

type ProgressResponse = {
  terminalState: string;
  stages: Record<string, StageInfo>;
  wandbRun?: { url?: string };
};

export default function ReviewDashboard() {
  const [submissionId, setSubmissionId] = useState('demo');
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/review/progress/${submissionId}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setProgress(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Human Review Dashboard</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label>
          Submission ID
          <input value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <button onClick={fetchProgress}>取得</button>
        {loading && <span>Loading...</span>}
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>
      {progress && (
        <section style={{ marginTop: 24 }}>
          <p>最終状態: {progress.terminalState}</p>
          <p>W&B: {progress.wandbRun?.url ? <a href={progress.wandbRun.url} target="_blank" rel="noreferrer">Runを開く</a> : 'N/A'}</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>ステージ</th>
                <th>状態</th>
                <th>試行数</th>
                <th>メッセージ</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(progress.stages).map(([stage, info]) => (
                <tr key={stage}>
                  <td>{stage}</td>
                  <td>{info.status}</td>
                  <td>{info.attempts}</td>
                  <td>{info.message ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
