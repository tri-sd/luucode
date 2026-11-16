export type TranslationErrorCode = 'KEY_FORMAT' | 'AUTH' | 'PERMISSION' | 'API_DISABLED' | 'KEY_BLOCKED' | 'QUOTA' | 'MODEL' | 'NETWORK' | 'TIMEOUT'
  | 'INVALID_JSON' | 'INVALID_COORDINATES' | 'SAFETY' | 'NO_TEXT' | 'CANCELLED'
  | 'IMAGE_ACCESS' | 'IMAGE_TOO_LARGE' | 'UNSUPPORTED_IMAGE' | 'STALE_IMAGE' | 'CAPTURE_FAILED'
  | 'NO_IMAGE' | 'CONFIG' | 'BUSY' | 'INTERNAL' | 'CHAPTER_ACCESS' | 'COLLECTION_REQUIRED' | 'LIVE_ONLY' | 'CACHE_STORAGE';

const messages: Record<TranslationErrorCode, string> = {
  CHAPTER_ACCESS: 'Chưa có quyền tải một số miền ảnh. Mở popup extension và bấm Dịch toàn bộ để cấp quyền rồi tiếp tục.',
  COLLECTION_REQUIRED: 'Hãy thu thập ảnh và bấm Kết thúc thu thập trước khi dịch toàn bộ chương.',
  LIVE_ONLY: 'Không thể tải lại ảnh này từ URL. Canvas/ảnh nội bộ cần mở đúng trang và dùng Dịch ảnh đang xem; chưa thể dịch lại trang canvas đã rời màn hình.',
  CACHE_STORAGE: 'Không lưu được dữ liệu chương. Kiểm tra dung lượng/quyền lưu trữ của trình duyệt; tác vụ đã dừng để tránh mất checkpoint.', 
  KEY_FORMAT: 'Chuỗi key vừa dán không đúng định dạng. Chỉ dán toàn bộ giá trị key, không kèm dấu ngoặc, Bearer hoặc xuống dòng. Hỗ trợ key dạng AQ. và AIza.',
  AUTH: 'Google không xác thực được key này. Kiểm tra đã sao chép đầy đủ key còn hiệu lực từ Google AI Studio.',
  PERMISSION: 'Google từ chối quyền truy cập. Kiểm tra project và giới hạn API/ứng dụng của key; lỗi này không nhất thiết là key sai.',
  API_DISABLED: 'Gemini API chưa được bật cho project của key. Kiểm tra Generative Language API trong Google Cloud/AI Studio.',
  KEY_BLOCKED: 'Google đã chặn key hoặc project này. Kiểm tra trạng thái trong Google AI Studio; thay key nếu được báo lộ hoặc thu hồi.',
  QUOTA: 'Gemini đang giới hạn tốc độ hoặc đã hết quota. Kiểm tra hạn mức/billing rồi thử lại sau.',
  MODEL: 'Model không dùng được với ảnh hoặc JSON schema này. Tải lại danh sách và chọn model Gemini hỗ trợ đầu vào ảnh.',
  NETWORK: 'Không kết nối được Gemini. Kiểm tra mạng rồi thử lại.',
  TIMEOUT: 'Đã hết thời gian xử lý. Bạn có thể tăng timeout hoặc chọn model khác rồi thử lại.',
  INVALID_JSON: 'Gemini trả dữ liệu JSON thiếu hoặc không đúng schema. Chưa áp dụng kết quả này lên ảnh.',
  INVALID_COORDINATES: 'Gemini trả tọa độ vùng chữ không hợp lệ. Chưa áp dụng kết quả này lên ảnh.',
  SAFETY: 'Gemini không xử lý nội dung ảnh này hoặc đã chặn kết quả.',
  NO_TEXT: 'Không nhận diện được vùng chữ nào trong ảnh.',
  CANCELLED: 'Đã hủy tác vụ dịch.',
  IMAGE_ACCESS: 'Không tải được ảnh gốc. Cấp quyền cho miền ảnh hoặc chọn Dùng ảnh chụp vùng hiển thị rồi bấm Dịch lại.',
  IMAGE_TOO_LARGE: 'Ảnh quá lớn hoặc quá dài cho một lần dịch. Hãy chọn ảnh/chunk nhỏ hơn.',
  CAPTURE_FAILED: 'Không chụp được tab. Giữ tab truyện đang mở, bấm lại biểu tượng extension và Dịch; nếu vừa chụp, chờ vài giây rồi thử lại. Kiểm tra quyền/chính sách trình duyệt nếu lỗi tiếp tục.',
  UNSUPPORTED_IMAGE: 'Định dạng hoặc hình học ảnh chưa được hỗ trợ. Xem Debug; tắt pinch zoom/xoay ảnh rồi thử lại.',
  STALE_IMAGE: 'Ảnh hoặc tài liệu đã thay đổi trong lúc dịch. Kết quả cũ đã bị loại bỏ; hãy dịch lại ảnh hiện tại.',
  NO_IMAGE: 'Chưa tìm thấy ảnh truyện có thể dịch trong vùng đang xem. Bấm Cập nhật ảnh và mở Debug Image Detection để xem lý do. Nội dung trong iframe cần mở thành tab riêng.',
  CONFIG: 'Hãy nhập API key và chọn model trong Tùy chọn trước khi dịch.',
  BUSY: 'Đang có một tác vụ dịch. Hủy hoặc chờ tác vụ đó hoàn tất trước.',
  INTERNAL: 'Tác vụ không hoàn tất. Hãy tải lại extension và trang rồi thử lại.',
};

export class TranslationError extends Error {
  retryAfterMs?: number;
  constructor(readonly code: TranslationErrorCode) {
    super(messages[code]);
    this.name = 'TranslationError';
  }
}

/** Never forward provider bodies, URLs, headers, keys or arbitrary exception messages. */
export function publicError(error: unknown): { code: TranslationErrorCode; message: string } {
  return error instanceof TranslationError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL', message: messages.INTERNAL };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TranslationError('CANCELLED');
}
