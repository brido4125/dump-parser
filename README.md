# dump-parser

ExamTopics 문제 페이지를 파싱하여 JSON으로 저장하는 CLI 도구입니다.

## 기능

- 문제 번호, 토픽, 본문, 선택지, 정답, 커뮤니티 투표 결과 파싱
- 문제에 포함된 이미지 자동 다운로드 (`images/` 디렉토리에 저장)
- 여러 URL 일괄 처리 지원
- 결과를 `results.json` 파일로 출력

## 설치

```bash
npm install
```

## 사용법

### URL 직접 입력

```bash
node parse.js <url1> <url2> ...
```

### 파일로 URL 목록 전달

```bash
node parse.js --file urls.txt
```

`urls.txt`에는 한 줄에 하나씩 URL을 작성합니다.

```
https://www.examtopics.com/discussions/amazon/view/12345
https://www.examtopics.com/discussions/amazon/view/67890
```

## 출력 형식

파싱 결과는 `results.json`에 저장되며, 각 문제는 다음 구조를 가집니다.

```json
{
  "topic": 1,
  "question_number": 123,
  "question": "문제 본문 텍스트...",
  "choices": {
    "A": "선택지 A",
    "B": "선택지 B",
    "C": "선택지 C",
    "D": "선택지 D"
  },
  "answer": "B",
  "community_votes": [
    { "answer": "B", "count": 42, "most_voted": true },
    { "answer": "A", "count": 5, "most_voted": false }
  ],
  "images": ["images/q123_0.png"],
  "url": "https://..."
}
```

## 참고

- 요청 간 1.5초 딜레이가 적용됩니다.
- 이미지가 포함된 문제의 경우 `images/` 디렉토리에 `q{번호}_{인덱스}.{확장자}` 형식으로 저장됩니다.
