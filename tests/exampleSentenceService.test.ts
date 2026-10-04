import { describe, it, expect } from 'vitest';
import { getExampleSentence } from '../src/services/exampleSentenceService';

describe('exampleSentenceService (빈출 실전문장 제공 엔진)', () => {
  it('토익 대표 빈출 어휘에 대해 고품질 비즈니스 실전 예문과 번역을 반환해야 한다', () => {
    const res = getExampleSentence('acquire', ['인수하다', '획득하다'], '동사');
    expect(res.text).toContain('acquire');
    expect(res.translation).toContain('인수할 계획');
    expect(res.highlightWord).toBe('acquire');
  });

  it('해사영어 어휘에 대해 표준 실무 통신/운항 예문을 반환해야 한다', () => {
    const res = getExampleSentence('abandon vessel', ['퇴선하다'], '동사');
    expect(res.text).toContain('abandon vessel');
    expect(res.translation).toContain('퇴선');
  });

  it('일본어 어휘에 대해 실전 생활/JLPT 예문을 반환해야 한다', () => {
    const res = getExampleSentence('約束 (やくそく)', ['약속'], '명사');
    expect(res.text).toContain('約束');
    expect(res.translation).toContain('약속');
  });

  it('사전에 없는 신규/커스텀 영어 어휘에 대해 품사와 뜻을 반영한 자연스러운 문맥 문장을 100% 자동 생성해야 한다', () => {
    const verbRes = getExampleSentence('customize', ['맞춤 설정하다'], '동사');
    expect(verbRes.text).toContain('customize');
    expect(verbRes.translation).toContain('customize');

    const nounRes = getExampleSentence('teleconference', ['화상 회의'], '명사');
    expect(nounRes.text).toContain('teleconference');
    expect(nounRes.translation).toContain('teleconference');
  });

  it('단어 자체에 커스텀 예문이 지정되어 있는 경우 최우선으로 반환해야 한다', () => {
    const res = getExampleSentence(
      'sample',
      ['샘플'],
      '명사',
      'This is a pre-defined custom sentence.',
      '이것은 사전에 정의된 커스텀 문장입니다.'
    );
    expect(res.text).toBe('This is a pre-defined custom sentence.');
    expect(res.translation).toBe('이것은 사전에 정의된 커스텀 문장입니다.');
  });
});
