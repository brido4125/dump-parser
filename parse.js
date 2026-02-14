import { load } from "cheerio";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 1500;
const IMAGES_DIR = resolve("images");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function downloadImage(imgUrl, localPath) {
  const res = await fetch(imgUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`  [warn] Failed to download image: ${imgUrl}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(localPath, buf);
  return true;
}

function parsePage(html, url) {
  const $ = load(html);

  // Question number & topic
  const headerText = $("div.question-discussion-header").text();
  const qMatch = headerText.match(/Question\s*#:\s*(\d+)/);
  const tMatch = headerText.match(/Topic\s*#:\s*(\d+)/);
  const questionNumber = qMatch ? parseInt(qMatch[1], 10) : null;
  const topic = tMatch ? parseInt(tMatch[1], 10) : null;

  // Question body
  const questionBody = $("div.question-body");
  const questionTextEl = questionBody.find("p.card-text").first();

  // Collect images from question body
  const images = [];
  questionBody.find("p.card-text img").each((i, el) => {
    const src = $(el).attr("src");
    if (src) images.push(src);
  });

  // Build question text — replace <br> with newlines, strip tags
  let questionText = "";
  const rawHtml = questionTextEl.html() || "";
  const cleaned = rawHtml.replace(/<br\s*\/?>/gi, "\n").trim();
  const $tmp = load(`<div>${cleaned}</div>`);
  // Replace img tags with placeholder
  $tmp("img").each((i, el) => {
    const src = $tmp(el).attr("src");
    const idx = images.indexOf(src);
    if (idx !== -1) {
      $tmp(el).replaceWith(`[image_${idx}]`);
    }
  });
  questionText = $tmp("div").text().trim();

  // Choices
  const choices = {};
  questionBody.find("li.multi-choice-item").each((_i, el) => {
    const letter = $(el).find("span.multi-choice-letter").attr("data-choice-letter");
    if (!letter) return;
    // Get text content excluding the letter span
    const clone = $(el).clone();
    clone.find("span.multi-choice-letter").remove();
    const choiceText = clone.text().trim();
    choices[letter] = choiceText;
  });

  // Suggested answer
  const answerEl = questionBody.find("span.correct-answer").first();
  const answer = answerEl.text().trim();

  // Answer image (for HOTSPOT questions)
  const answerImages = [];
  answerEl.find("img").each((i, el) => {
    const src = $(el).attr("src");
    if (src) answerImages.push(src);
  });

  // Community votes
  let communityVotes = [];
  const voteScript = questionBody.find("div.voted-answers-tally script").html();
  if (voteScript) {
    try {
      const voteData = JSON.parse(voteScript);
      communityVotes = voteData.map((v) => ({
        answer: v.voted_answers,
        count: v.vote_count,
        most_voted: v.is_most_voted,
      }));
    } catch {
      // ignore parse errors
    }
  }

  return {
    topic,
    question_number: questionNumber,
    question: questionText,
    choices,
    answer,
    community_votes: communityVotes,
    images: images, // raw URLs, will be updated after download
    answer_images: answerImages, // raw URLs for HOTSPOT answer images
    url,
  };
}

async function processImages(result) {
  const hasImages = result.images.length > 0;
  const hasAnswerImages = result.answer_images.length > 0;
  if (!hasImages && !hasAnswerImages) return result;

  if (!existsSync(IMAGES_DIR)) {
    await mkdir(IMAGES_DIR, { recursive: true });
  }

  // Download question images
  const localPaths = [];
  for (let i = 0; i < result.images.length; i++) {
    let imgUrl = result.images[i];
    if (imgUrl.startsWith("/")) {
      imgUrl = `https://www.examtopics.com${imgUrl}`;
    }
    const ext = extname(new URL(imgUrl).pathname) || ".png";
    const filename = `q${result.question_number}_${i}${ext}`;
    const localPath = resolve(IMAGES_DIR, filename);
    const relativePath = `images/${filename}`;

    const ok = await downloadImage(imgUrl, localPath);
    if (ok) {
      localPaths.push(relativePath);
      result.question = result.question.replace(
        `[image_${i}]`,
        `[이미지: ${relativePath}]`
      );
    } else {
      localPaths.push(imgUrl);
    }
  }
  result.images = localPaths;

  // Download answer images (HOTSPOT)
  const answerLocalPaths = [];
  for (let i = 0; i < result.answer_images.length; i++) {
    let imgUrl = result.answer_images[i];
    if (imgUrl.startsWith("/")) {
      imgUrl = `https://www.examtopics.com${imgUrl}`;
    }
    const ext = extname(new URL(imgUrl).pathname) || ".png";
    const filename = `q${result.question_number}_answer_${i}${ext}`;
    const localPath = resolve(IMAGES_DIR, filename);
    const relativePath = `images/${filename}`;

    const ok = await downloadImage(imgUrl, localPath);
    if (ok) {
      answerLocalPaths.push(relativePath);
    } else {
      answerLocalPaths.push(imgUrl);
    }
  }
  result.answer_images = answerLocalPaths;

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let urls = [];

  if (args[0] === "--file" && args[1]) {
    const content = await readFile(args[1], "utf-8");
    urls = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.startsWith("http"));
  } else {
    urls = args.filter((a) => a.startsWith("http"));
  }

  if (urls.length === 0) {
    console.log("Usage:");
    console.log("  node parse.js <url1> <url2> ...");
    console.log("  node parse.js --file urls.txt");
    process.exit(1);
  }

  console.log(`Parsing ${urls.length} URLs...\n`);
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);
    try {
      const html = await fetchPage(url);
      let result = parsePage(html, url);
      result = await processImages(result);
      results.push(result);

      // Print summary
      console.log(`  Q${result.question_number} (Topic ${result.topic}): ${result.question.slice(0, 80)}...`);
      console.log(`  Answer: ${result.answer}`);
      if (result.community_votes.length > 0) {
        const top = result.community_votes.find((v) => v.most_voted);
        if (top) console.log(`  Most Voted: ${top.answer} (${top.count} votes)`);
      }
      console.log();
    } catch (err) {
      console.error(`  [error] ${err.message}\n`);
    }

    // Rate limiting
    if (i < urls.length - 1) await sleep(DELAY_MS);
  }

  // Write results
  const outPath = resolve("results.json");
  await writeFile(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Done! ${results.length} questions saved to results.json`);
}

main();
