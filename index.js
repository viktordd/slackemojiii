require("dotenv").config();

const puppeteer = require("puppeteer");
const fs = require("fs");

const /** @type {puppeteer.GoToOptions} */ gotoOption = {
    waitUntil: "domcontentloaded",
  };

const workSpaceName = process.env.WORK_SPACE_NAME;
const userName = process.env.USER_NAME;
const password = process.env.PASS_WORD;
const directory = process.env.npm_config_directory || process.env.DIRECTORY;
const progressFile = `${directory}/progress.json`;

const signInPasswordSelector = '[data-qa="sign_in_password_link"]';
const addButtonSelector = '[data-qa="customize_emoji_add_button"]';
const uploadImageSelector =
  'input[data-qa="customize_emoji_add_dialog_file_input"]';
const nameInputSelector = '[data-qa="customize_emoji_add_dialog_input"]';
const duplicateSelector =
  '[data-qa="customize_emoji_add_dialog_duplicate_preview"]';
const errorSelector = '[data-qa="customize_emoji_add_dialog_error"]';
const saveButtonSelector = '[data-qa="customize_emoji_add_dialog_go"]';
const closeModalSelector = '[data-qa="sk_close_modal_button"]';

const INFO = "\x1b[36m%s\x1b[0m";
const WARNING = "\x1b[33m%s\x1b[0m";
const ERROR = "\x1b[31m%s\x1b[0m";

const addEmoji = async (
  /** @type {puppeteer.Page} */ page,
  /** @type {string} */ url,
  /** @type {string[]} */ progress,
  /** @type {number} */ num
) => {
  const type = url.match(/\.(jpe?g|png|gif)$/);
  if (!type) {
    console.log(WARNING, `${num} Skipped: ${url}`);
    return;
  }
  if (progress.includes(url) || progress.includes(`Duplicate: ${url}`)) {
    console.log(WARNING, `${num} Skipped: ${url}`);
    return;
  }
  if (progress.includes(`Failed: ${url}`)) {
    console.log(WARNING, `${num} Skipped previously failed: ${url}`);
    return;
  }

  // Wait and click add button
  await page.waitForSelector(addButtonSelector);
  await page.click(addButtonSelector, { delay: 500 });
  // Wait and click button upload file
  await page.waitForSelector(uploadImageSelector);
  const inputFile = await page.$(uploadImageSelector);
  await inputFile?.uploadFile(url);

  await page.waitForSelector(nameInputSelector);
  const nameInput = await page.$(nameInputSelector);
  // Append the file type at the end to prevent duplicate that have the same name but different file type
  await nameInput?.type(`-${type[1]}`, { delay: 100 });

  try {
    // If duplicate preview is shown, it means the emoji is already uploaded.
    await page.waitForSelector(duplicateSelector, { timeout: 250 });
    console.log(WARNING, `${num} Duplicate: ${url}`);
    writeProgress(progress, `Duplicate: ${url}`);
    await page.click(closeModalSelector, { delay: 100 });
    return;
  } catch (error) {}

  try {
    // Click save button
    await page.click(saveButtonSelector, { delay: 100 });

    // Wait the modal disappear to complete upload
    const res = await Promise.race([
      page
        .waitForSelector(saveButtonSelector, {
          hidden: true,
          timeout: 60_000,
        })
        .then(() => "done")
        .catch(() => "timeout"),
      page
        .waitForSelector(errorSelector, { timeout: 65_000 })
        .then(() => "error")
        .catch(),
    ]);

    if (res === "done") {
      writeProgress(progress, url);
      console.log(INFO, `${num} Uploaded: ${url}`);
    } else {
      if (res === "error") {
        console.log(WARNING, `${num} Upload failed: ${url}`);
        writeProgress(progress, `Failed: ${url}`);
      } else {
        console.log(WARNING, `${num} Timeout: ${url}`);
        writeProgress(progress, `Timeout: ${url}`);
      }

      try {
        await page.click(closeModalSelector, { delay: 100 });
      } catch (e) {
        console.log(ERROR, `${num} Error: ${e.message}`);
      }
    }
  } catch (error) {
    // If the modal is not disappeared. There are some error. Skip this upload by clicking the close button
    console.log(WARNING, `${num} Upload failed: ${url}`);
    console.log(WARNING, error.message);
    writeProgress(progress, `Failed: ${url}`);

    try {
      await page.click(closeModalSelector, { delay: 100 });
    } catch (e) {
      console.log(ERROR, `${num} Error: ${e.message}`);
    }
  }
};

const readProgress = () => {
  console.log(INFO, `Reading progress from ${progressFile}`);
  const text = fs.existsSync(progressFile)
    ? fs.readFileSync(progressFile, { encoding: "utf8" })
    : null;

  return text ? JSON.parse(text) : [];
};

const writeProgress = (
  /** @type {string[]} */ progress,
  /** @type {string} */ item
) => {
  if (item) {
    progress.push(item);
  }
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), {
    encoding: "utf8",
  });
};

const main = async () => {
  try {
    if (!workSpaceName || !userName || !password || !directory) {
      console.log(ERROR, "Please set environment variables");
      console.log(INFO, "Press Ctrl+C to terminate");
      return;
    }
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--disable-notifications", "--start-maximized"],
    });
    const page = await browser.newPage();
    page.setViewport({
      width: 1280,
      height: 1080,
    });
    await page.goto(
      `https://${workSpaceName}.slack.com/customize/emoji`,
      gotoOption
    );

    // Sign in
    await page.waitForSelector(signInPasswordSelector);
    await page.click(signInPasswordSelector);
    await page.waitForSelector("#password");
    await page.focus("#email");
    await page.keyboard.type(userName);
    await page.focus("#password");
    await page.keyboard.type(password);
    await page.click("#signin_btn");

    // get all files in directory
    const files = fs.readdirSync(directory, { recursive: true });
    const progress = readProgress();

    // Wait add emoji screen
    await page.waitForSelector(addButtonSelector, { timeout: 0 });
    // Add custom css to hide toast (Toast can overlay the  button and we can not click it)
    await page.addStyleTag({
      content:
        ".ReactModal__Overlay.ReactModal__Overlay--before-close{display: none!important}",
    });

    console.log(INFO, `Uploading ${files.length} images from ${directory}`);
    for (let i = 0; i < files.length; i++) {
      const filePath = `${directory}/${files[i]}`;
      await addEmoji(page, filePath, progress, i);
    }
    console.log(INFO, "DONE");
  } catch (error) {
    console.log(ERROR, `Error: ${error.message}`);
    console.log(INFO, "Press Ctrl+C to terminate");
  }
};

main();
