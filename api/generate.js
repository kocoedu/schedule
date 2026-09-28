/**
 * Vercel Serverless Function: api/generate.js
 * 
 * - 보안: GEMINI_API_KEY 환경변수를 서버 사이드에서 안전하게 호출
 * - 모델: gemini-3-flash-preview (구조화된 JSON 스키마 적용)
 * - 종속성: Node.js 18+ 네이티브 fetch 사용 (외부 패키지 설치 불일치 오류 방지)
 */

export default async function handler(req, res) {
  // CORS 및 프리플라이트 요청 처리
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: '지원하지 않는 HTTP 메서드입니다. POST 요청만 허용됩니다.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(500).json({
      error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 대시보드 [Settings] -> [Environment Variables]에서 등록 후 재배포(Redeploy)해주세요.'
    });
  }

  const body = req.body || {};
  const wakeSleepTime = body.wakeSleepTime || '07:30 - 23:30';
  const fixedSchedules = (body.fixedSchedules || '').trim();
  const priorities = (body.priorities || '').trim();
  const notes = (body.notes || '').trim();

  if (!fixedSchedules) {
    return res.status(400).json({
      error: '고정 강의 및 미팅 일정(시간, 장소)을 최소 1개 이상 입력해주세요.'
    });
  }

  const systemPrompt = `
당신은 프리랜서 강사, 1인 지식창업가를 위한 정상급 시간관리 및 생산성 컨설턴트입니다.
불규칙한 강의 일정, 장소 이동에 따른 체력 소모, 목소리 피로도, 에너지 고갈 패턴을 깊이 이해하고 있습니다.
사용자가 제공한 고정 일정 사이사이에 [강의, 강의준비, 공부, 운동, 이동, 휴식/식사]를 최적으로 재배치하여 빈틈없고 현실적인 하루 시간표를 작성하세요.

[필수 원칙]
1. 고정 강의 전후 최소 30분의 버퍼(장비 세팅, 장소 이동, 목 풀기 및 멘탈 준비)를 꼭 확보하세요.
2. 대중교통/차량 이동 시간대에는 무리한 작업 대신 팟캐스트, 오디오북, 가벼운 마인드셋 점검 등 실천 가능한 틈새 팁을 제안하세요.
3. 강의 직후는 에너지가 급격히 소진되므로 무거운 학습 대신 가벼운 산책, 수분 섭취, 휴식/식사를 우선 배치하세요.
4. 카테고리는 반드시 ["강의", "강의준비", "공부", "운동", "이동", "휴식/식사"] 중 하나로 정확하게 지정하세요.
`;

  const userQuery = `
- 활동 가능 시간(기상~취침): ${wakeSleepTime}
- 고정 일정(강의/미팅/컨설팅):
${fixedSchedules}

- 꼭 챙기고 싶은 개인 루틴(공부/강의준비/운동):
${priorities || '운동 40분, 강의 준비 1.5시간, 자기계발 공부 1시간'}

- 컨디션 및 특이사항 메모:
${notes || '특이사항 없음'}

위 조건을 종합하여 현실적이고 건강한 하루 타임라인을 구성해주세요.
`;

  const payload = {
    contents: [
      { parts: [{ text: userQuery }] }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: {
            type: "STRING",
            description: "오늘 하루 일정 운영을 위한 핵심 조언 및 멘탈 관리 전략 한 줄 요약"
          },
          schedule: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                time: {
                  type: "STRING",
                  description: "시간대 (예: 08:00 - 09:00)"
                },
                activity: {
                  type: "STRING",
                  description: "구체적 활동 내용"
                },
                category: {
                  type: "STRING",
                  enum: ["강의", "강의준비", "공부", "운동", "이동", "휴식/식사"]
                },
                tip: {
                  type: "STRING",
                  description: "해당 시간대를 지혜롭게 보내기 위한 구체적 실천 조언"
                }
              },
              required: ["time", "activity", "category", "tip"]
            }
          }
        },
        required: ["summary", "schedule"]
      }
    }
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  
  let attempts = 3;
  let delay = 1000;
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const statusMessage = errorData.error?.message || `HTTP ${response.status} 오류`;
        throw new Error(`Gemini API 통신 실패: ${statusMessage}`);
      }

      const result = await response.json();
      const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!generatedText) {
        throw new Error('Gemini 모델로부터 생성된 답변 텍스트가 비어있습니다.');
      }

      const parsedData = JSON.parse(generatedText);
      return res.status(200).json(parsedData);

    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  console.error('Final API Handler Error:', lastError);
  return res.status(500).json({
    error: lastError?.message || '일정을 재배치하는 과정에서 서버 오류가 발생했습니다.'
  });
}