import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './app/App.css';
import './features/conversation/conversation.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('루트 DOM 요소를 찾을 수 없습니다.');
}

// 은퇴한 레거시 쿼리 파라미터(voice-check, build, speech-check) 정리 (새로고침 없이 URL만 정규화)
// speech-debug 등 유효한 진단 파라미터는 그대로 보존
if (typeof window !== 'undefined' && window.location.search) {
  try {
    const params = new URLSearchParams(window.location.search);
    const retiredParams = ['voice-check', 'build', 'speech-check'];
    let changed = false;
    for (const p of retiredParams) {
      if (params.has(p)) {
        params.delete(p);
        changed = true;
      }
    }
    if (changed) {
      const newQuery = params.toString();
      const newRelativePathQuery =
        window.location.pathname + (newQuery ? `?${newQuery}` : '') + window.location.hash;
      window.history.replaceState(window.history.state, '', newRelativePathQuery);
    }
  } catch {
    // URL 정리 실패 시에도 앱 렌더링은 정상 진행
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
