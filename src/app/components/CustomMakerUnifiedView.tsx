import React, { useState } from 'react';
import { GeneralQuizImportView } from './GeneralQuizImportView';
import { CustomVocabularyUnifiedView } from './CustomVocabularyUnifiedView';

interface Props {
  onBackToHome: () => void;
  onStartGeneralQuiz: (bookId: string) => void;
  onStartVocabQuiz: (words: Array<{ word: string; meaning: string[] }>, title?: string, sourceType?: 'photo' | 'pdf') => void;
}

export const CustomMakerUnifiedView: React.FC<Props> = ({
  onBackToHome,
  onStartGeneralQuiz,
  onStartVocabQuiz,
}) => {
  const [activeSubMode, setActiveSubMode] = useState<'general' | 'vocab'>('general');

  return (
    <div className="custom-maker-container" style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* 2대 제작 모드 서브 탭 */}
      <div style={{ marginBottom: '14px' }}>
        <div
          className="book-selector-tabs"
          style={{ width: '100%', margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
        >
          <button
            type="button"
            className={`book-tab-btn ${activeSubMode === 'general' ? 'active' : ''}`}
            onClick={() => setActiveSubMode('general')}
          >
            <span>📚</span>
            <span>4/5지선다 문제집 제작</span>
          </button>
          <button
            type="button"
            className={`book-tab-btn ${activeSubMode === 'vocab' ? 'active' : ''}`}
            onClick={() => setActiveSubMode('vocab')}
          >
            <span>🔤</span>
            <span>영단어장 제작 (사진/PDF)</span>
          </button>
        </div>
      </div>

      {activeSubMode === 'general' ? (
        <GeneralQuizImportView
          onBackToHome={onBackToHome}
          onStartQuiz={onStartGeneralQuiz}
        />
      ) : (
        <CustomVocabularyUnifiedView
          onBack={onBackToHome}
          onStartQuizWithWords={onStartVocabQuiz}
        />
      )}
    </div>
  );
};
