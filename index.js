require("dotenv").config();

const puppeteer = require("puppeteer");
const fs = require("fs");

const gotoOption = {
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
  if (progress.includes(url)) {
    console.log(WARNING, `${num} Skipped: ${url}`);
    return;
  }
  if (progress.includes(`Failed: ${url}`)) {
    console.log(WARNING, `${num} Skipped previously failed: ${url}`);
    return;
  }

  // Wait and click add button
  await page.waitForSelector(addButtonSelector);
  await page.click(addButtonSelector, { delay: 1000 });
  // Wait and click button upload file
  await page.waitForSelector(uploadImageSelector);
  const inputFile = await page.$(uploadImageSelector);
  await inputFile?.uploadFile(url);

  await page.waitForSelector(nameInputSelector);
  const name = await page.$eval(nameInputSelector, (input) => input.value);

  try {
    // If duplicate preview is shown, it means the emoji is already uploaded.
    await page.waitForSelector(duplicateSelector, { timeout: 700 });
    console.log(WARNING, `${num} Duplicate: ${url}`);

    // this could be because images have the same name but different file type
    // change the name and try again
    const nameInput = await page.$(nameInputSelector);
    await nameInput?.click({ clickCount: 3 });
    await nameInput?.type(`${name}-${type[1]}`);
    await new Promise((r) => setTimeout(r, 100));

    await page.waitForSelector(duplicateSelector, { timeout: 700 });
    console.log(WARNING, `${num} Duplicate: ${url}. ${name}-${type[1]}`);

    writeProgress(progress, `Duplicate: ${url}`);
    await page.click(closeModalSelector);
  } catch (error) {}

  try {
    // Click save button
    await page.click(saveButtonSelector);
    // Wait the modal disappear to complete upload
    await page.waitForSelector(saveButtonSelector, {
      hidden: true,
      timeout: 30000,
    });
    writeProgress(progress, url);
    console.log(INFO, `${num} Uploaded: ${url}`);
  } catch (error) {
    // If the modal is not disappeared. There are some error. Skip this upload by clicking the close button
    console.log(WARNING, `${num} Upload failed: ${url}`);
    console.log(WARNING, error.message);
    writeProgress(progress, `Failed: ${url}`);
    try {
      await page.click(closeModalSelector);
    } catch (e) {
      console.log(ERROR, `${num} Error: ${e.message}`);
    }
  }
};

const readProgress = () => {
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
    await page.focus("#email");
    await page.keyboard.type(userName);
    await page.focus("#password");
    await page.keyboard.type(password);
    await page.click("#signin_btn");

    // Wait add emoji screen
    await page.waitForSelector(addButtonSelector, { timeout: 0 });
    // Add custom css to hide toast (Toast can overlay the  button and we can not click it)
    await page.addStyleTag({
      content:
        ".ReactModal__Overlay.ReactModal__Overlay--before-close{display: none!important}",
    });

    // get all files in directory
    const files = fs.readdirSync(directory, { recursive: true });
    const progress = readProgress();

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
