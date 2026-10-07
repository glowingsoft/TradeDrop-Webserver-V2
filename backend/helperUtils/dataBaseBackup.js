const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { uploadFilesToS3 } = require("../controllers/uploadAWSController");

const BACKUP_DIR = path.join(__dirname, "..", "database_backups");
const OLD_BACKUP_DIR = path.join(__dirname, "..", "database_backups", "backups.gz");

const backupMongoDB = async () => {
  console.log("Starting MongoDB backup...");

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.gz`);

  const dumpCommand = `mongodump --uri="${process.env.BASE_URL}" --gzip --archive="${backupPath}"`;

  exec(dumpCommand, async (err, stdout, stderr) => {
    if (err) {
      console.error("Error during MongoDB backup:", err);
      console.error(stderr);
      return;
    }

    console.log("MongoDB backup completed");

    await uploadBackupToS3(backupPath);
  });
};

const uploadBackupToS3 = async (backupPath) => {
  try {
    const file = await fs.promises.readFile(backupPath);

    const fileObj = {
      buffer: file,
      filename: path.basename(backupPath),
    };

    await uploadFilesToS3([fileObj]);

    console.log("Database Backup uploaded to S3");

    await fs.promises.unlink(backupPath);
    console.log("Local backup deleted:", path.basename(backupPath));

    await deleteOldBackupFolder();
  } catch (err) {
    console.error("Error uploading/deleting backup:", err);
  }
};

const deleteOldBackupFolder = async () => {
  try {
    if (fs.existsSync(OLD_BACKUP_DIR)) {
      await fs.promises.rm(OLD_BACKUP_DIR, {
        recursive: true,
        force: true,
      });

      console.log("Old backup folder deleted");
    }
  } catch (err) {
    console.error("Error deleting old backup folder:", err);
  }
};

module.exports = { backupMongoDB };