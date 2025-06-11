import { ReactiveCache } from '/imports/reactiveCache';
import { Meteor } from 'meteor/meteor';
import { FilesCollection } from 'meteor/ostrio:files';
import { isFileValid } from './fileValidation';
import { createBucket } from './lib/grid/createBucket';
import fs from 'fs';
import path from 'path';
import { AttachmentStoreStrategyFilesystem, AttachmentStoreStrategyGridFs, AttachmentStoreStrategyS3 } from '/models/lib/attachmentStoreStrategy';
import FileStoreStrategyFactory, {moveToStorage, rename, STORAGE_NAME_FILESYSTEM, STORAGE_NAME_GRIDFS, STORAGE_NAME_S3} from '/models/lib/fileStoreStrategy';
import { GridFSFiles } from 'meteor/ostrio:files';

let attachmentUploadExternalProgram;
let attachmentUploadMimeTypes = [];
let attachmentUploadSize = 0;
let attachmentBucket;
let storagePath;

if (Meteor.isServer) {
  attachmentBucket = createBucket('attachments');

  if (process.env.ATTACHMENTS_UPLOAD_MIME_TYPES) {
    attachmentUploadMimeTypes = process.env.ATTACHMENTS_UPLOAD_MIME_TYPES.split(',');
    attachmentUploadMimeTypes = attachmentUploadMimeTypes.map(value => value.trim());
  }

  if (process.env.ATTACHMENTS_UPLOAD_MAX_SIZE) {
    attachmentUploadSize = parseInt(process.env.ATTACHMENTS_UPLOAD_MAX_SIZE);

    if (isNaN(attachmentUploadSize)) {
      attachmentUploadSize = 0;
    }
  }

  if (process.env.ATTACHMENTS_UPLOAD_EXTERNAL_PROGRAM) {
    attachmentUploadExternalProgram = process.env.ATTACHMENTS_UPLOAD_EXTERNAL_PROGRAM;

    if (!attachmentUploadExternalProgram.includes("{file}")) {
      attachmentUploadExternalProgram = undefined;
    }
  }

  // Add a fallback default path if WRITABLE_PATH is not defined
  const writablePath = process.env.WRITABLE_PATH || '/default/path/to/writable';
  storagePath = path.join(writablePath, 'attachments');
}


export const fileStoreStrategyFactory = new FileStoreStrategyFactory(AttachmentStoreStrategyFilesystem, storagePath, AttachmentStoreStrategyGridFs, attachmentBucket);

// XXX Enforce a schema for the Attachments FilesCollection
// see: https://github.com/VeliovGroup/Meteor-Files/wiki/Schema

Attachments = new FilesCollection({
  debug: false, // Change to `true` for debugging
  collectionName: 'attachments',
  allowClientCode: true,
  namingFunction(opts) {
    let filenameWithoutExtension = ""
    let fileId = "";
    if (opts?.name) {
      // Client
      filenameWithoutExtension = opts.name.replace(/(.+)\..+/, "$1");
      fileId = opts.meta.fileId;
      delete opts.meta.fileId;
    } else if (opts?.file?.name) {
      // Server
      if (opts.file.extension) {
        filenameWithoutExtension = opts.file.name.replace(new RegExp(opts.file.extensionWithDot + "$"), "")
      } else {
        // file has no extension, so don't replace anything, otherwise the last character is removed (because extensionWithDot = '.')
        filenameWithoutExtension = opts.file.name;
      }
      fileId = opts.fileId;
    }
    else {
      // should never reach here
      filenameWithoutExtension = Math.random().toString(36).slice(2);
      fileId = Math.random().toString(36).slice(2);
    }

    // OLD:
    //const ret = fileId + "-original-" + filenameWithoutExtension;
    // NEW: Save file only with filename of ObjectID, not including filename.
    // Fixes https://github.com/wekan/wekan/issues/4416#issuecomment-1510517168
    const ret = fileId;
    // remove fileId from meta, it was only stored there to have this information here in the namingFunction function
    return ret;
  },
  sanitize(str, max, replacement) {
    // keep the original filename
    return str;
  },
  storagePath() {
    return fileStoreStrategyFactory.storagePath;
  },
  onAfterUpload(fileObj) {
    if (Meteor.isServer) {
      try {
        // 파일 유효성 검사
        if (!isFileValid(fileObj)) {
          console.error('유효하지 않은 파일:', fileObj);
          return;
        }

        // 파일 시스템에서 파일 읽기
        let fileData;
        if (fileObj.versions && fileObj.versions.original && fileObj.versions.original.path) {
          try {
            fileData = fs.readFileSync(fileObj.versions.original.path);
          } catch (error) {
            console.error('파일 읽기 실패:', error);
            return;
          }
        } else {
          console.error('파일 경로를 찾을 수 없습니다:', fileObj);
          return;
        }

        // 파일 크기에 따라 업로드 방식 선택
        if (fileObj.size > 5 * 1024 * 1024) { // 5MB 이상
          // 청크 단위 업로드
          const chunkSize = 1024 * 1024; // 1MB
          const totalChunks = Math.ceil(fileData.length / chunkSize);

          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, fileData.length);
            const chunk = fileData.slice(start, end);

            Meteor.call('uploadFileChunk',
              chunk,
              fileObj.name,
              fileObj.type,
              i,
              totalChunks
            );
          }
        } else {
          // 작은 파일은 한 번에 업로드
          Meteor.call('uploadFileAsText',
            fileData,
            fileObj.name,
            fileObj.type
          );
        }

        // 메타데이터 업데이트
        Attachments.update(fileObj._id, {
          $set: {
            'meta.gridFsFileId': fileObj._id,
            'meta.storageStrategy': 'gridfs'
          }
        });

      } catch (error) {
        console.error('파일 처리 중 오류 발생:', error);
        // 실패한 경우 파일 삭제
        if (fileObj && fileObj._id) {
          Attachments.remove(fileObj._id);
        }
      }
    }
  },
  interceptDownload(http, fileObj, versionName) {
    const ret = fileStoreStrategyFactory.getFileStrategy(fileObj, versionName).interceptDownload(http, this.cacheControl);
    return ret;
  },
  onAfterRemove(files) {
    if (Meteor.isServer) {
      files.forEach(fileObj => {
        try {
          if (fileObj.meta && fileObj.meta.gridFsFileId) {
            GridFSFiles.remove({ _id: fileObj.meta.gridFsFileId });
          }
        } catch (error) {
          console.error('GridFS 파일 삭제 실패:', error);
        }
      });
    }
  },
  // We authorize the attachment download either:
  // - if the board is public, everyone (even unconnected) can download it
  // - if the board is private, only board members can download it
  protected(fileObj) {
    // file may have been deleted already again after upload validation failed
    if (!fileObj) {
      return false;
    }

    const board = ReactiveCache.getBoard(fileObj.meta.boardId);
    if (board.isPublic()) {
      return true;
    }

    return board.hasMember(this.userId);
  },
});

if (Meteor.isServer) {
  Attachments.allow({
    insert(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    update(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    remove(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    fetch: ['meta'],
  });

  Meteor.methods({
    moveAttachmentToStorage(fileObjId, storageDestination) {
      check(fileObjId, String);
      check(storageDestination, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      moveToStorage(fileObj, storageDestination, fileStoreStrategyFactory);
    },
    renameAttachment(fileObjId, newName) {
      check(fileObjId, String);
      check(newName, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      rename(fileObj, newName, fileStoreStrategyFactory);
    },
    validateAttachment(fileObjId) {
      check(fileObjId, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      const isValid = Promise.await(isFileValid(fileObj, attachmentUploadMimeTypes, attachmentUploadSize, attachmentUploadExternalProgram));

      if (!isValid) {
        Attachments.remove(fileObjId);
      }
    },
    validateAttachmentAndMoveToStorage(fileObjId, storageDestination) {
      check(fileObjId, String);
      check(storageDestination, String);

      Meteor.call('validateAttachment', fileObjId);

      const fileObj = ReactiveCache.getAttachment(fileObjId);

      if (fileObj) {
        Meteor.defer(() => Meteor.call('moveAttachmentToStorage', fileObjId, storageDestination));
      }
    },
  });

 Meteor.startup(() => {
  Attachments.collection.createIndex({ 'meta.cardId': 1 });

  const storagePath = fileStoreStrategyFactory.storagePath;
  if (!storagePath) {
    console.error('Storage path is undefined. Check your environment variables.');
    return;
  }

  if (!fs.existsSync(storagePath)) {
    console.log("Creating storagePath because it doesn't exist: " + storagePath);
    fs.mkdirSync(storagePath, { recursive: true });
  }
});

}

export default Attachments;
