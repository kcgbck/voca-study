// 범용 문제집 만들기 UI 컴포넌트 (GEN-01 지시서 48~56항 준수)
import React, { useState } from 'react';
import type { QuestionItem, DocumentType } from '../../types/question';
import { extractQuestionsFromOcrBlocks } from '../../ocr/multipleChoiceExtractor';
import { classifyDocument } from '../../ocr/documentClassifier';
import { extractAnswerKeys, mapAnswerKeysToQuestions } from '../../ocr/answerKeyExtractor';
import { extractGeneralQuestionsFromPdf } from '../../pdf/generalPdfParser';
import { tesseractEngine } from '../../ocr/tesseractOcrEngine';
import { db } from '../../storage/db';

interface Props {
  onBackToHome: () => void;
  onStartQuiz: (bookId: string) => void;
}

export const GeneralQuizImportView: React.FC<Props> = ({ onBackToHome: _onBackToHome, onStartQuiz }) => {
  const [docType, setDocType] = useState<DocumentType>('MULTIPLE_CHOICE');
  const [docClassificationReason, setDocClassificationReason] = useState<string>('');
  const [bookTitle, setBookTitle] = useState<string>('신규 일반 문제집');
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'needs_review' | 'missing' | 'low_conf'>('all');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);

  // 1. 문제 이미지 / PDF 파일 업로드 핸들러
  const handleMainFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMessage('파일을 분석하는 중입니다...');
    setProgressPercent(10);

    try {
      const fileName = file.name;
      setBookTitle(fileName.replace(/\.[^/.]+$/, ''));

      if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
        // PDF 처리
        setStatusMessage('PDF 문서에서 텍스트 및 문제를 추출하고 있습니다...');
        const arrayBuf = await file.arrayBuffer();
        setProgressPercent(30);

        const pdfResult = await extractGeneralQuestionsFromPdf(arrayBuf, {
          onProgress: (cur, tot) => {
            setProgressPercent(30 + Math.round((cur / tot) * 50));
            setStatusMessage(`PDF ${cur}/${tot} 페이지 분석 중...`);
          },
        });

        setDocType(pdfResult.classification.type);
        setDocClassificationReason(pdfResult.classification.reasons.join(', '));
        setQuestions(pdfResult.questions);
        setProgressPercent(100);
        setStatusMessage(`추출 완료: 총 ${pdfResult.questions.length}문항 감지`);
      } else if (file.type.startsWith('image/')) {
        // 이미지 처리
        setStatusMessage('Tesseract OCR 엔진을 초기화하고 있습니다...');
        await tesseractEngine.init((p: { status: string; progress: number }) => {
          setStatusMessage(`${p.status} (${Math.round(p.progress * 100)}%)`);
          setProgressPercent(20 + Math.round(p.progress * 50));
        });

        setStatusMessage('이미지 내 텍스트와 문제를 인식하고 있습니다...');
        const imgUrl = URL.createObjectURL(file);
        const img = new Image();
        img.src = imgUrl;
        await new Promise((res) => { img.onload = res; });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0);

        const blocks = await tesseractEngine.recognize(canvas);
        setProgressPercent(80);

        const classification = classifyDocument(blocks);
        setDocType(classification.type);
        setDocClassificationReason(classification.reasons.join(', '));

        const result = extractQuestionsFromOcrBlocks(blocks, 'imported-img');
        setQuestions(result.questions);
        setProgressPercent(100);
        setStatusMessage(`추출 완료: 총 ${result.questions.length}문항 감지`);
        URL.revokeObjectURL(imgUrl);
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`오류 발생: ${err?.message || '파일 처리 실패'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. 별도 정답표 파일 업로드 핸들러
  const handleAnswerKeyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || questions.length === 0) return;

    setIsProcessing(true);
    setStatusMessage('정답표 이미지를 인식하고 있습니다...');
    try {
      const imgUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = imgUrl;
      await new Promise((res) => { img.onload = res; });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);

      await tesseractEngine.init();
      const blocks = await tesseractEngine.recognize(canvas);
      const answerKeys = extractAnswerKeys(blocks);

      const mappingResult = mapAnswerKeysToQuestions(questions, answerKeys);
      setQuestions(mappingResult.mappedQuestions);

      let msg = `정답표 매핑 완료: ${mappingResult.matchedCount}문항 정답 연결 성공`;
      if (mappingResult.warnings.length > 0) {
        msg += ` (${mappingResult.warnings[0]})`;
      }
      setStatusMessage(msg);
      URL.revokeObjectURL(imgUrl);
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`정답표 인식 실패: ${err?.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 정답 수동 선택
  const handleSelectCorrectChoice = (questionIndex: number, choiceId: string) => {
    setQuestions((prev) => {
      const copy = [...prev];
      const target = { ...copy[questionIndex] };
      target.correctChoiceId = choiceId;
      target.answerStatus = 'verified';
      target.isUserConfirmed = true;
      copy[questionIndex] = target;
      return copy;
    });
  };

  // 문항 제외 토글
  const handleToggleExclude = (questionIndex: number) => {
    setQuestions((prev) => {
      const copy = [...prev];
      const target = { ...copy[questionIndex] };
      target.answerStatus = target.answerStatus === 'missing' ? 'needs_review' : 'missing';
      copy[questionIndex] = target;
      return copy;
    });
  };

  // 필터 적용 목록
  const filteredQuestions = questions.filter((q) => {
    if (activeFilter === 'needs_review') return q.answerStatus === 'needs_review';
    if (activeFilter === 'missing') return q.answerStatus === 'missing';
    if (activeFilter === 'low_conf') return q.questionConfidence === 'low' || q.answerConfidence === 'low';
    return true;
  });

  // 3. 문제집 저장 및 IndexedDB 영속화 (지시서 41항)
  const handleSaveToDatabase = async () => {
    if (questions.length === 0) {
      alert('저장할 문항이 없습니다.');
      return;
    }

    try {
      const bookId = await db.questionBooks.add({
        title: bookTitle.trim() || '신규 문제집',
        sourceType: 'IMAGE',
        questionType: 'MULTIPLE_CHOICE',
        questionCount: questions.length,
        createdAt: new Date().toISOString(),
      });

      const questionsToSave = questions.map((q) => ({
        ...q,
        bookId: String(bookId),
      }));

      await db.questions.bulkAdd(questionsToSave);
      alert(`문제집 [${bookTitle}] (${questions.length}문항)이 안전하게 저장되었습니다!`);
      onStartQuiz(String(bookId));
    } catch (err: any) {
      console.error(err);
      alert(`저장 실패: ${err?.message}`);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '16px' }}>
      {/* 상단 네비게이션 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
        <h2 style={{
          fontSize: 'clamp(15px, 4vw, 18px)',
          fontWeight: 'bold',
          color: '#60a5fa',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          margin: 0,
          textAlign: 'center',
          flex: 1
        }}>
          📚 일반 객관식 문제집 만들기
        </h2>
        <div style={{ width: '34px', flexShrink: 0 }} />
      </div>

      {/* 파일 업로드 카드 */}
      <div style={{ background: '#1f2937', padding: '16px', borderRadius: '12px', border: '1px solid #374151', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '15px', color: '#f3f4f6', marginBottom: '8px' }}>1. 문제 파일(사진 또는 PDF) 선택</h3>
        <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px' }}>
          자격증, 공무원, 수능 등 어떤 문제집 사진이나 전자 PDF도 100% 기기 내에서 안전하게 분석합니다. (서버 전송 0)
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ background: '#2563eb', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
            📷 사진 촬영 / 이미지 선택
            <input type="file" accept="image/*" onChange={handleMainFileChange} style={{ display: 'none' }} disabled={isProcessing} />
          </label>
          <label style={{ background: '#059669', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
            📄 PDF 문서 선택
            <input type="file" accept="application/pdf" onChange={handleMainFileChange} style={{ display: 'none' }} disabled={isProcessing} />
          </label>
          {questions.length > 0 && (
            <label style={{ background: '#d97706', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
              🔑 별도 정답표 사진 추가
              <input type="file" accept="image/*" onChange={handleAnswerKeyFileChange} style={{ display: 'none' }} disabled={isProcessing} />
            </label>
          )}
        </div>

        {/* 진행 상태 바 */}
        {isProcessing && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ height: '6px', background: '#374151', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: '12px', color: '#93c5fd', marginTop: '6px' }}>{statusMessage}</p>
          </div>
        )}
      </div>

      {/* 분석 결과 및 문서 유형 강제 선택 (지시서 13항) */}
      {questions.length > 0 && (
        <div style={{ background: '#111827', padding: '14px', borderRadius: '10px', border: '1px solid #1f2937', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '13px', color: '#9ca3af' }}>문서 판별 결과: </span>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: docType === 'MULTIPLE_CHOICE' ? '#34d399' : '#f59e0b' }}>
                {docType === 'MULTIPLE_CHOICE' ? '일반 객관식 문제집' : docType === 'VOCABULARY' ? '영어 단어장' : '정답표'}
              </span>
              {docClassificationReason && (
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>({docClassificationReason})</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af', alignSelf: 'center' }}>수동 변경:</span>
              <button
                onClick={() => setDocType('MULTIPLE_CHOICE')}
                style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', background: docType === 'MULTIPLE_CHOICE' ? '#2563eb' : '#374151', color: '#fff', border: 'none' }}
              >
                객관식
              </button>
              <button
                onClick={() => setDocType('VOCABULARY')}
                style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', background: docType === 'VOCABULARY' ? '#2563eb' : '#374151', color: '#fff', border: 'none' }}
              >
                단어장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 문항 검토 및 편집 영역 (지시서 48, 49항) */}
      {questions.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <input
              type="text"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="문제집 제목"
              style={{ background: '#1f2937', color: '#fff', border: '1px solid #4b5563', padding: '6px 12px', borderRadius: '6px', fontSize: '15px', fontWeight: 'bold', width: '60%' }}
            />
            <button
              onClick={handleSaveToDatabase}
              style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              💾 문제집 저장
            </button>
          </div>

          {/* 일괄 필터 탭 */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
            <button
              onClick={() => setActiveFilter('all')}
              style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: 'none', background: activeFilter === 'all' ? '#3b82f6' : '#374151', color: '#fff' }}
            >
              전체 ({questions.length})
            </button>
            <button
              onClick={() => setActiveFilter('needs_review')}
              style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: 'none', background: activeFilter === 'needs_review' ? '#f59e0b' : '#374151', color: '#fff' }}
            >
              확인 필요 ({questions.filter((q) => q.answerStatus === 'needs_review').length})
            </button>
            <button
              onClick={() => setActiveFilter('missing')}
              style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: 'none', background: activeFilter === 'missing' ? '#ef4444' : '#374151', color: '#fff' }}
            >
              정답 미확인 ({questions.filter((q) => q.answerStatus === 'missing').length})
            </button>
            <button
              onClick={() => setActiveFilter('low_conf')}
              style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: 'none', background: activeFilter === 'low_conf' ? '#6b7280' : '#374151', color: '#fff' }}
            >
              낮은 신뢰도
            </button>
          </div>

          {/* 문항 카드 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredQuestions.map((q, qIdx) => {
              const realIndex = questions.findIndex((item) => item.id === q.id);
              return (
                <div
                  key={q.id || qIdx}
                  style={{
                    background: '#1f2937',
                    padding: '14px',
                    borderRadius: '10px',
                    border: q.answerStatus === 'verified' ? '1px solid #10b981' : q.answerStatus === 'needs_review' ? '1px solid #f59e0b' : '1px solid #ef4444',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ background: '#3b82f6', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                        문제 {q.questionNumber || realIndex + 1}
                      </span>
                      <span style={{ fontSize: '11px', color: q.answerStatus === 'verified' ? '#34d399' : q.answerStatus === 'needs_review' ? '#fbbf24' : '#f87171' }}>
                        {q.answerStatus === 'verified' ? '✓ 정답 확인됨' : q.answerStatus === 'needs_review' ? '⚠ 검토 필요' : '✕ 정답 미입력'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleToggleExclude(realIndex)}
                      style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: '#374151', color: '#9ca3af', border: 'none', cursor: 'pointer' }}
                    >
                      {q.answerStatus === 'missing' ? '복구' : '제외'}
                    </button>
                  </div>

                  {/* 본문 */}
                  <div style={{ fontSize: '14px', color: '#f3f4f6', fontWeight: '600', marginBottom: '10px', lineHeight: '1.5' }}>
                    {q.stem}
                  </div>

                  {/* 선택지 목록 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {q.choices.map((c) => {
                      const isCorrect = q.correctChoiceId === c.id;
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectCorrectChoice(realIndex, c.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            background: isCorrect ? 'rgba(16, 185, 129, 0.2)' : '#111827',
                            border: isCorrect ? '1px solid #10b981' : '1px solid #374151',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontWeight: 'bold', color: isCorrect ? '#34d399' : '#9ca3af', fontSize: '13px' }}>
                            {c.sourceLabel}
                          </span>
                          <span style={{ fontSize: '13px', color: isCorrect ? '#ffffff' : '#d1d5db' }}>
                            {c.text}
                          </span>
                          {isCorrect && (
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#34d399', fontWeight: 'bold' }}>
                              [정답]
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
