const multer = require("multer");
const path = require("path");

// Set storage engine
const storage = multer.diskStorage({
  destination: "./uploads/", // Specify the destination folder
  filename: (req, file, cb) => {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

const memoryStorage = multer.memoryStorage();
const uploadToMemory = multer({ storage: memoryStorage }).single("file");

// Initialize upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 3000000 }, // Limit file size to 3MB
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
}).single("file");

// Check file type
function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|gif|webp|svg|bmp|tiff|tif|avif|heic|heif/;

  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  const mimetype = filetypes.test(file.mimetype);

  if (extname || mimetype) {
    return cb(null, true);
  }

  cb(new Error("Error: Images Only!"));
}

module.exports = {
  upload,
  uploadToMemory,
};
