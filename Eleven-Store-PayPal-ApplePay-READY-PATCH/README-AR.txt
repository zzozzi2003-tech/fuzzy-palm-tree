Eleven Store - PayPal + Apple Pay Patch

هذه النسخة تضيف:
- PayPal Checkout
- Apple Pay عبر PayPal (المبلغ يدخل إلى نفس حساب PayPal)
- التحويل البنكي يبقى موجوداً
- لا يوجد مجلد data داخل هذا الـPatch، لذلك لا يستبدل منتجاتك الحالية.

مهم قبل رفع Apple Pay Live:
1. فعّل Apple Pay داخل تطبيق PayPal Live إذا كان الخيار متاحاً لحسابك.
2. حمّل ملف Domain Association من PayPal.
3. ضعه في public/.well-known/ باسم:
   apple-developer-merchantid-domain-association
4. ارفع الموقع واعمل Deploy.
5. افتح الرابط التالي وتأكد أنه يرجع الملف مباشرة:
   https://eleven-store-sa.onrender.com/.well-known/apple-developer-merchantid-domain-association
6. ارجع PayPal وسجل الدومين eleven-store-sa.onrender.com

تنبيه: Apple Pay عبر PayPal لا يظهر إلا إذا PayPal اعتبر حساب التاجر/الدولة/الدومين والجهاز مؤهلة.
على Windows غالباً سترى رسالة عدم توفر Apple Pay بدل الزر.
