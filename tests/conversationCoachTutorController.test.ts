import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachTutorController } from '../src/features/conversation/coach/CoachTutorController';
import { COACH_QUESTIONS } from '../src/features/conversation/coach/coachProtocol';
const good = { meaning: 'relevant' as const, sentenceComplete: true, feedbackKo: '좋아요. 뜻을 정확히 전달했어요.', modelAnswerEn: 'My name is Alex.' };
const uncertain = { ...good, meaning: 'uncertain' as const, sentenceComplete: false, feedbackKo: '뜻을 확실하게 이해하지 못했어요.' };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function setup(answers = ['My name is Alex.', 'My name is Alex.'], options = { thinkingMs: 0, answerWindowMs: 6000 }) {
  const states: any[] = [];
  const speak = vi.fn().mockResolvedValue(true);
  const listen = vi.fn(async (_lang: string) => answers.shift() ?? '');
  const evaluate = vi.fn().mockResolvedValue(good);
  const cancel = vi.fn();
  const controller = new CoachTutorController({ speak, listen, evaluate, cancel, emit: value => states.push(structuredClone(value)) }, options);
  return { controller, states, speak, listen, evaluate, cancel };
}

describe('beginner Korean-guided tutor', () => {
  it('defaults to ten seconds and evaluates a late final answer without a confirmation round', async () => {
    vi.useFakeTimers();const states:any[]=[];const evaluate=vi.fn().mockResolvedValue(uncertain);
    const listen=vi.fn((_lang:string, options:any)=>{options.onReady();return new Promise<string>(resolve=>setTimeout(()=>resolve('My name is Alex.'),9500));});
    const controller=new CoachTutorController({speak:vi.fn().mockResolvedValue(true),listen,evaluate,cancel:vi.fn(),emit:s=>states.push(s)});
    const pending=controller.start(COACH_QUESTIONS[0]);await flush();
    expect(listen.mock.calls[0][1].windowMs).toBe(10000);expect(states.at(-1).message).toContain('10초');
    await vi.advanceTimersByTimeAsync(8000);expect(evaluate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);await pending;
    expect(evaluate).toHaveBeenCalledExactlyOnceWith('name','My name is Alex.');expect(vi.getTimerCount()).toBe(0);
  });
  it('starts immediately and directly evaluates final English before counting practice', async () => {
    vi.useFakeTimers();
    const h = setup();
    const pending = h.controller.start(COACH_QUESTIONS[0]); await flush();
    expect(h.speak.mock.calls[0]).toEqual([COACH_QUESTIONS[0].scenarioKo, 'ko-KR']);
    expect(h.speak.mock.calls[1]).toEqual([COACH_QUESTIONS[0].questionEn, 'en-US']);
    expect(h.states.some(s => s.phase === 'thinking')).toBe(false);
    await pending;
    expect(h.listen.mock.calls.map(call => call[0])).toEqual(['en-US', 'en-US']);
    expect(h.evaluate).toHaveBeenCalledOnce();
    expect(h.states.at(-1)).toMatchObject({ phase: 'complete', practiceDone: 1, practiceTarget: 1 });
    expect(h.speak.mock.calls.some(([text, lang]) => lang === 'ko-KR' && text.includes('좋아요'))).toBe(true);
  });

  it('evaluates the raw transcript without a confirmation round or silently rewriting it', async () => {
    const h = setup(['Might aim is Alice.']); h.evaluate.mockResolvedValue(uncertain);
    await h.controller.start(COACH_QUESTIONS[0]);
    expect(h.evaluate).toHaveBeenCalledExactlyOnceWith(COACH_QUESTIONS[0].id, 'Might aim is Alice.');
    expect(h.listen.mock.calls.map(c => c[0])).toEqual(['en-US']);
    expect(h.speak.mock.calls.some(c => /맞나요|아니요|인식 후보/.test(c[0]))).toBe(false);
    expect(h.states.at(-1)).toMatchObject({phase:'paused', practiceDone:0});
  });

  it('short meaningful answers lead to two practices without being labelled meaningless', async () => {
    const h = setup(['Alex.', 'My name is Alex.', 'My name is Alex.']);
    h.evaluate.mockResolvedValueOnce({ ...good, sentenceComplete: false, feedbackKo: '뜻은 맞아요. 완전한 문장으로 확장해 봐요.' });
    await h.controller.start(COACH_QUESTIONS[0]);
    expect(h.states.at(-1)).toMatchObject({ phase: 'complete', practiceDone: 2, practiceTarget: 2 });
  });

  it('uncertain AI interpretation cannot mark any practice as passed', async () => {
    const h = setup(); h.evaluate.mockResolvedValue(uncertain);
    await h.controller.start(COACH_QUESTIONS[0]);
    expect(h.states.at(-1).phase).toBe('paused');
    expect(h.states.at(-1).practiceDone).toBe(0);
    expect(h.states.some(state => state.phase === 'complete')).toBe(false);
  });

  it('incorrect repeat answers do not increment the counter and stop after bounded attempts', async () => {
    const h = setup(['My name is Alex.', 'wrong', 'wrong', 'wrong']);
    h.evaluate.mockResolvedValueOnce(good).mockResolvedValue({ ...good, meaning: 'needs_help', sentenceComplete: false });
    await h.controller.start(COACH_QUESTIONS[0]);
    expect(h.states.at(-1).phase).toBe('paused'); expect(h.states.at(-1).practiceDone).toBe(0);
    expect(h.evaluate.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('only final captured words are evaluated, with no Korean microphone round', async () => {
    const h = setup(['Coffee, please.', "I would like coffee, please.", "I would like coffee, please."]);
    h.evaluate.mockResolvedValueOnce({...good, sentenceComplete:false, modelAnswerEn:'I would like coffee, please.'});
    await h.controller.start(COACH_QUESTIONS[2]);
    expect(h.evaluate.mock.calls[0]).toEqual(['cafe','Coffee, please.']);
    expect(h.evaluate).toHaveBeenCalledTimes(2);
    expect(h.listen.mock.calls.map(c => c[0])).toEqual(['en-US','en-US','en-US']);
    expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:2,practiceTarget:2});
  });

  it('pause during preparation settles the run and prevents later microphone activity', async () => {
    vi.useFakeTimers();
    const h = setup(undefined, { thinkingMs: 10000, answerWindowMs: 45000 });
    const pending = h.controller.start(COACH_QUESTIONS[0]); await flush();
    h.controller.pause(); await pending; await vi.advanceTimersByTimeAsync(60000);
    expect(h.states.at(-1).phase).toBe('paused'); expect(h.listen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('silence keeps waiting within a bounded window and is never graded', async () => {
    vi.useFakeTimers(); const h = setup();
    h.listen.mockRejectedValue(Object.assign(new Error('무음'), { code: 'no-speech' }));
    const pending = h.controller.start(COACH_QUESTIONS[0]); await flush();
    await vi.advanceTimersByTimeAsync(45001); await pending;
    // Initial answer and one prompted repetition each allow at most eight silence retries.
    expect(h.evaluate).not.toHaveBeenCalled(); expect(h.listen.mock.calls.length).toBeLessThanOrEqual(16);
    expect(h.states.at(-1).phase).toBe('paused');
    expect(h.states.at(-1).phase).not.toBe('complete'); expect(h.states.at(-1).practiceDone).toBe(0);
  });

  it('failed speech output stops before listening or grading', async () => {
    const h = setup(); h.speak.mockResolvedValue(false);
    await h.controller.start(COACH_QUESTIONS[0]);
    expect(h.listen).not.toHaveBeenCalled(); expect(h.evaluate).not.toHaveBeenCalled();
    expect(h.states.at(-1).phase).toBe('error');
  });

  it('a stalled TTS is bounded to fifteen seconds', async () => {
    vi.useFakeTimers(); const h = setup();
    h.speak.mockImplementation(() => new Promise(() => {}));
    void h.controller.start(COACH_QUESTIONS[0]); await flush();
    await vi.advanceTimersByTimeAsync(15001);
    expect(h.states.at(-1).phase).toBe('error'); expect(h.listen).not.toHaveBeenCalled();
    h.controller.pause();
  });

  it('pause settles even when the native listener ignores cancellation', async () => {
    const h = setup(); h.listen.mockImplementation(() => new Promise(() => {}));
    let settled = false;
    void h.controller.start(COACH_QUESTIONS[0]).then(() => { settled = true; }); await flush();
    h.controller.pause(); await flush();
    expect(settled).toBe(true); expect(h.states.at(-1).phase).toBe('paused');
  });

  it('an unending native listening session cannot exceed the answer deadline', async () => {
    vi.useFakeTimers(); const h = setup(); h.listen.mockImplementation(() => new Promise(() => {}));
    void h.controller.start(COACH_QUESTIONS[0]); await flush();
    await vi.advanceTimersByTimeAsync(45001);
    expect(h.states.some(s => s.feedbackKo.includes('괜찮아요'))).toBe(true);
    expect(h.states.at(-1)).toMatchObject({ practiceTarget: 2, practiceDone: 0 });
    expect(h.listen).toHaveBeenCalledTimes(2); expect(h.evaluate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45001);
    expect(h.states.at(-1).phase).toBe('paused');
    h.controller.pause();
  });
});

it('fatal microphone permission failure is preserved and never graded', async () => {
  const h = setup(); h.listen.mockRejectedValue(Object.assign(new Error('마이크 권한을 허용해 주세요.'), { code: 'not-allowed' }));
  await h.controller.start(COACH_QUESTIONS[0]);
  expect(h.states.at(-1).phase).toBe('error'); expect(h.evaluate).not.toHaveBeenCalled();
});

it('a completed question cannot gain credit from a later text submission', async () => {
  const h = setup(); await h.controller.start(COACH_QUESTIONS[0]);
  await h.controller.submitText('My name is Alex.');
  expect(h.evaluate).toHaveBeenCalledOnce(); expect(h.states.at(-1).practiceDone).toBe(1);
});

it('uncertain repetition stops without incrementing credit', async () => {
  const h = setup(['My name is Alex.', 'might aim axle']); h.evaluate.mockResolvedValueOnce(good).mockResolvedValue(uncertain);
  await h.controller.start(COACH_QUESTIONS[0]);
  expect(h.evaluate).toHaveBeenCalledTimes(2); expect(h.states.at(-1)).toMatchObject({ phase: 'paused', practiceDone: 0 });
});

it('a hanging AI evaluation has a twenty-five second ceiling and never completes', async () => {
  vi.useFakeTimers(); const h = setup(); h.evaluate.mockImplementation(() => new Promise(() => {}));
  void h.controller.start(COACH_QUESTIONS[0]); await flush();
  expect(h.evaluate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(25001);
  expect(h.states.at(-1).phase).toBe('error'); expect(h.states.at(-1).practiceDone).toBe(0);
  h.controller.pause();
});

it('a stalled repetition is never graded or credited after the initial direct evaluation', async () => {
  vi.useFakeTimers(); const h = setup();
  h.listen.mockResolvedValueOnce('My name is Alex.').mockImplementation(() => new Promise(() => {}));
  void h.controller.start(COACH_QUESTIONS[0]); await flush(); await vi.advanceTimersByTimeAsync(20001);
  expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0}); expect(h.evaluate).toHaveBeenCalledOnce();
  h.controller.pause();
});

it('initial silence offers an ungraded example and still requires two successful practices', async () => {
  vi.useFakeTimers(); const h = setup(['I am twenty years old.', 'I am twenty years old.']);
  h.listen.mockRejectedValueOnce(Object.assign(new Error('무음'),{code:'no-speech'}));
  const pending=h.controller.start(COACH_QUESTIONS[1]);await flush();await vi.advanceTimersByTimeAsync(1500);await pending;
  expect(h.evaluate).toHaveBeenCalledOnce();expect(h.evaluate.mock.calls.every(c=>c[1]==='I am twenty years old.')).toBe(true);
  expect(h.speak.mock.calls.some(c=>c[0]===COACH_QUESTIONS[1].exampleAnswerEn&&c[1]==='en-US')).toBe(true);
  expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:2,practiceTarget:2});
});

it('duplicate text submissions during evaluation do not cause a second model call', async () => {
 const h=setup();h.listen.mockImplementation(()=>new Promise(()=>{}));h.evaluate.mockImplementation(()=>new Promise(()=>{}));
 void h.controller.start(COACH_QUESTIONS[0]);await flush();
 void h.controller.submitText('My name is Alex.');await flush();
 void h.controller.submitText('My name is Alex.');await flush();
 expect(h.evaluate).toHaveBeenCalledOnce();h.controller.pause();await flush();
});

it('default coaching starts listening immediately after the English question, with no thinking or extra spoken prompt', async()=>{
 const states:any[]=[];const speak=vi.fn().mockResolvedValue(true);const listen=vi.fn().mockImplementation(()=>new Promise(()=>{}));const evaluate=vi.fn();
 const controller=new CoachTutorController({speak,listen,evaluate,cancel:vi.fn(),emit:s=>states.push(s)});
 void controller.start(COACH_QUESTIONS[0]);await flush();
 expect(listen).toHaveBeenCalledOnce();expect(states.some(s=>s.phase==='thinking')).toBe(false);
 expect(speak.mock.calls).toEqual([[COACH_QUESTIONS[0].scenarioKo,'ko-KR'],[COACH_QUESTIONS[0].questionEn,'en-US']]);
 controller.pause();await flush();
});

it('late microphone preview callbacks cannot reopen a completed question',async()=>{
 const states:any[]=[];const options:any[]=[];const answers=['My name is Alex.','My name is Alex.'];
 const listen=vi.fn(async(_lang:string,opts?:any)=>{if(opts)options.push(opts);return answers.shift()??'';});
 const controller=new CoachTutorController({speak:vi.fn().mockResolvedValue(true),listen,evaluate:vi.fn().mockResolvedValue(good),cancel:vi.fn(),emit:s=>states.push(s)});
 await controller.start(COACH_QUESTIONS[0]);expect(options.length).toBeGreaterThan(0);const count=states.length;
 options[0].onPartial?.('late wrong words');options[0].onReady?.();expect(states.length).toBe(count);expect(states.at(-1).phase).toBe('complete');
});
