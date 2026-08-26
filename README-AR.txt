Eleven Store - PayPal Ready Patch

طريقة التركيب:
1) ارفع الملفات الموجودة في هذا المجلد فوق الملفات المطابقة في مشروع GitHub الحالي.
2) لا تحذف أو تستبدل مجلد data ولا uploads.
3) لا ترفع أي .env إلى GitHub.
4) تأكد أن هذه المتغيرات موجودة في Render > Environment:
   PAYPAL_CLIENT_ID = Live Client ID من PayPal
   PAYPAL_CLIENT_SECRET = Live Client Secret من PayPal
   PAYPAL_MODE = live
   PAYPAL_CURRENCY = USD
   PAYPAL_SAR_PER_UNIT = 3.75
5) اترك متغيرات SUPABASE_* الحالية كما هي.
6) بعد الرفع استخدم Deploy latest commit في Render.

ملاحظة:
المفاتيح السرية غير موجودة داخل هذا الملف حفاظاً على أمان الحساب.
