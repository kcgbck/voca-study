import React, { useState } from 'react';
import { FileImportPocView } from './FileImportPocView';
import { PdfImportPocView } from './PdfImportPocView';

interface Props {
  onStartQuizWithWords: (
    words: Array<{ word: string; meaning: string[] }>,
    title?: string,
    sourceType?: 'photo' | 'pdf'
  ) => void;
  initialMode?: 'photo' | 'pdf';
  onBack?: () => void;
}

export const CustomVocabularyUnifiedView: React.FC<Props> = ({
  onStartQuizWithWords,
  initialMode = 'photo',
  onBack: _onBack,
}) => {
  const [mode, setMode] = useState<'photo' | 'pdf'>(initialMode);

  return (
    <div className="custom-vocab-unified-view" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 사진 vs PDF 통합 선택 탭 */}
      <div style={{ marginBottom: '4px' }}>
        <div className="book-selector-tabs" style={{ width: '100%', margin: 0, gridTemplateColumns: '1fr 1fr' }}>
          <button
            type="button"
            className={`book-tab-btn ${mode === 'photo' ? 'active' : ''}`}
            onClick={() => setMode('photo')}
          >
            <span>📷</span>
            <span>사진 / OCR</span>
          </button>
          <button
            type="button"
            className={`book-tab-btn ${mode === 'pdf' ? 'active' : ''}`}
            onClick={() => setMode('pdf')}
          >
            <span>📄</span>
            <span>PDF 어휘 추출</span>
          </button>
        </div>
      </div>

      {/* 선택된 모드 렌더링 */}
      {mode === 'photo' ? (
        <FileImportPocView
          onStartQuizWithWords={(words) =>
            onStartQuizWithWords(words, '사진 OCR 추출 영단어장', 'photo')
          }
        />
      ) : (
        <PdfImportPocView
          onStartQuizWithWords={(words) =>
            onStartQuizWithWords(words, 'PDF 추출 영단어장', 'pdf')
          }
        />
      )}
    </div>
  );
};
