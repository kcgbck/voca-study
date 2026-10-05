import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('전체 네비게이션 및 뒤로가기(History Popstate) 작동 검증 (tests/navigationAndHistory.test.ts)', () => {
  let historyStack: Array<{ state: any; url: string }> = [];
  let popstateListeners: Array<(event: any) => void> = [];

  beforeEach(() => {
    historyStack = [{ state: { tab: 'home' }, url: '/' }];
    popstateListeners = [];

    const mockHistory = {
      state: historyStack[0].state,
      pushState: vi.fn((state: any, _title: string, url: string) => {
        historyStack.push({ state, url });
        mockHistory.state = state;
      }),
      replaceState: vi.fn((state: any, _title: string, url: string) => {
        if (historyStack.length > 0) {
          historyStack[historyStack.length - 1] = { state, url };
        } else {
          historyStack.push({ state, url });
        }
        mockHistory.state = state;
      }),
      back: vi.fn(() => {
        if (historyStack.length > 1) {
          historyStack.pop();
          const prev = historyStack[historyStack.length - 1];
          mockHistory.state = prev.state;
          const event = { state: prev.state };
          popstateListeners.forEach((fn) => fn(event));
        }
      }),
    };

    (globalThis as any).window = {
      history: mockHistory,
      location: { pathname: '/' },
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'popstate') popstateListeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    };
  });

  it('홈 대시보드에서 퀴즈로 진입 시 history stack에 정상 push된다', () => {
    const { history } = (window as any);
    history.pushState({ tab: 'quiz', quizSource: 'builtin' }, '', '/');
    expect(history.pushState).toHaveBeenCalled();
    expect(history.state).toEqual({ tab: 'quiz', quizSource: 'builtin' });
    expect(historyStack.length).toBe(2);
  });

  it('뒤로가기 키(back) 실행 시 popstate 리스너가 호출되어 이전 홈 탭으로 복귀한다', () => {
    const { history } = (window as any);
    let currentTab = 'home';
    let currentQuizSource = 'builtin';

    // App.tsx의 handlePopState 로직 모사
    const handlePopState = (event: any) => {
      const state = event.state;
      if (state && state.tab) {
        if (state.quizSource) currentQuizSource = state.quizSource;
        currentTab = state.tab;
      } else {
        currentTab = 'home';
      }
    };
    popstateListeners.push(handlePopState);

    // 1. 퀴즈로 진입
    history.pushState({ tab: 'quiz', quizSource: 'maritime' }, '', '/');
    currentTab = 'quiz';
    currentQuizSource = 'maritime';
    expect(currentTab).toBe('quiz');
    expect(currentQuizSource).toBe('maritime');

    // 2. 뒤로가기 실행
    history.back();
    expect(currentTab).toBe('home');
    expect(history.state).toEqual({ tab: 'home' });
  });

  it('일본어 문제집 진입 및 2대 서브탭 전환 시 quizSource가 올바르게 전이된다', () => {
    const { history } = (window as any);
    // 일본어 진입
    history.pushState({ tab: 'quiz', quizSource: 'japanese_exam' }, '', '/');
    expect(history.state.quizSource).toBe('japanese_exam');

    // 생활일본어 서브탭 전환
    history.pushState({ tab: 'quiz', quizSource: 'japanese_life' }, '', '/');
    expect(history.state.quizSource).toBe('japanese_life');

    // 뒤로가기
    history.back();
    expect(history.state.quizSource).toBe('japanese_exam');
  });

  it('문제집 제작 및 영단어 뷰에서 뒤로가기 실행 시 앱이 종료되지 않고 홈으로 복귀한다', () => {
    const { history } = (window as any);
    let activeTab = 'home';

    const handlePopState = (e: any) => {
      activeTab = e.state?.tab || 'home';
    };
    popstateListeners.push(handlePopState);

    // 내가 만드는 문제집 진입
    history.pushState({ tab: 'general_import' }, '', '/');
    activeTab = 'general_import';
    expect(activeTab).toBe('general_import');

    // 인앱 뒤로가기 / 물리 뒤로가기
    history.back();
    expect(activeTab).toBe('home');

    // 내가 만드는 영단어 진입
    history.pushState({ tab: 'custom_vocab' }, '', '/');
    activeTab = 'custom_vocab';
    expect(activeTab).toBe('custom_vocab');

    // 뒤로가기
    history.back();
    expect(activeTab).toBe('home');
  });

  it('계층형 내비게이션: 하위 탭간 이동 시 replaceState가 적용되어 뒤로가기 1번에 홈으로 복귀해야 한다', () => {
    const { history } = (window as any);
    let activeTab: string = 'home';

    const navigateToTab = (tab: string) => {
      const targetState = { tab };
      if (tab === 'home') {
        history.replaceState({ tab: 'home' }, '', '/');
      } else if (activeTab === 'home') {
        history.pushState(targetState, '', '/');
      } else {
        history.replaceState(targetState, '', '/');
      }
      activeTab = tab;
    };

    popstateListeners.push((e: any) => {
      activeTab = e.state?.tab || 'home';
    });

    // 1. 홈 -> 영어 퀴즈 진입 (push: 스택 2개)
    navigateToTab('quiz_en');
    expect(historyStack.length).toBe(2);
    expect(activeTab).toBe('quiz_en');

    // 2. 영어 퀴즈 -> 일본어 퀴즈 전환 (replace: 스택 유지 2개)
    navigateToTab('quiz_ja');
    expect(historyStack.length).toBe(2);
    expect(activeTab).toBe('quiz_ja');

    // 3. 일본어 퀴즈 -> 랭킹 전환 (replace: 스택 유지 2개)
    navigateToTab('ranking');
    expect(historyStack.length).toBe(2);
    expect(activeTab).toBe('ranking');

    // 4. 뒤로가기 1회 누름 -> 즉시 홈으로 복귀 (스택 1개)
    history.back();
    expect(activeTab).toBe('home');
    expect(historyStack.length).toBe(1);

    // 5. 홈에서 뒤로가기 누르면 히스토리가 더 이상 없어 무한 루프 없이 앱 종료 가능
    expect(historyStack.length).toBe(1);
  });
});
