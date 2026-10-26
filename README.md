# Tarneeb server

خادم مستقل للعبة طرنيب: Node.js 22 وFirebase Admin SDK، يعمل على Render Free دون Cloud Functions أو ترقية Firebase إلى Blaze. يشمل منطق اللعب والملفات الشخصية والأصدقاء والدعوات والغرف ولوحة إدارة عربية.

## التشغيل والاختبار

```sh
npm ci
# انسخ .env.example إلى .env واضبط القيم ثم:
node --env-file=.env server.js
npm test
# يتطلب Firebase CLI وJava:
firebase emulators:exec --config firebase.test.json --project demo-tarneeb-secure --only firestore "npm test"
```

لا يحتاج البناء أو الاختبار إلى Godot أو مشروع TypeScript. fixtures توافق Godot محفوظة داخل test/fixtures. npm test يتخطى اختبارات قاعدة البيانات خارج المحاكي؛ الأمر الأخير يشغلها جميعًا على بيانات مؤقتة، وليس الإنتاج.

## النشر على Render Free

1. اربط هذا المستودع بخدمة Web Service مجانية أو استورد render.yaml كـ Blueprint. اترك Root Directory فارغًا. البناء `npm ci --omit=dev` والتشغيل `npm start`.
2. اضبط PUBLIC_ORIGIN على عنوان الخدمة HTTPS دون مسار مثل /online أو /admin. يقبل الخادم الشرطة النهائية والمسافات المحيطة ويزيلها تلقائيًا.
3. اضبط FIREBASE_PROJECT_ID وFIRESTORE_DATABASE_ID وFIREBASE_WEB_API_KEY حسب مشروع Firebase. معرفات المشروع الحالي موجودة في .env.example.
4. ضع Firebase Authentication UID الخاص بالمسؤول في ADMIN_UIDS؛ يمكن فصل عدة معرفات بفواصل. الاسم والبريد لا يمنحان صلاحيات الإدارة.
5. أضف حساب خدمة مخصصًا كـ Render Secret File باسم firebase-service-account.json. GOOGLE_APPLICATION_CREDENTIALS مضبوط على /etc/secrets/firebase-service-account.json. امنحه صلاحيات Firestore وFirebase Authentication المطلوبة فقط، لا دور Owner. ملف Google Desktop OAuth ليس حساب خدمة ولا يصلح لهذا الغرض.
6. لا ترفع ملف حساب الخدمة أو .env إلى Git أو Godot. ضع الأسرار في إعدادات Render فقط.
7. بعد اختبار الخادم انشر القواعد والفهارس من هذا المستودع:

```sh
firebase deploy --only "firestore:rules,firestore:indexes" --project gen-lang-client-0141680917
```

انتظر جاهزية الفهارس. القواعد تمنع الكتابة المباشرة من العملاء؛ نسق نشرها مع تحديث اللعبة لأن العميل القديم غير متوافق. إعداد النشر لا يتضمن Cloud Functions أو موارد مدفوعة.

## ربط Godot

اضبط SERVER_URL في scripts/firebase_config.gd على أصل HTTPS نفسه دون /online. يمكن استخدام متغير البيئة TARNEEB_SERVER_URL أثناء التطوير. ترسل اللعبة Firebase ID token إلى /online؛ UID مستخرج من التوكن المتحقق منه. مهلة طلب اللعب 75 ثانية لكل محاولة لاستيعاب إيقاظ Render دون حجب الواجهة.

## لوحة الإدارة

افتح /admin. استخدم زر Google أو حساب Firebase Email/Password؛ يجب أن يكون UID الحساب ضمن ADMIN_UIDS. فعّل مزود الدخول المطلوب في Firebase. تسجيل الدخول عبر Google لا يحتاج إعداد كلمة مرور للوحة.

الجلسة Cookie لمدة 8 ساعات، HttpOnly وSecure وSameSite=Strict في الإنتاج. يتحقق الخادم من إلغاء الجلسات والحظر، ومن أصل عمليات الإدارة. تعرض اللوحة المستخدمين على صفحات وآخر 30 غرفة وآخر 30 سجل إدارة. تتيح حظر/إعادة تفعيل المستخدم وإغلاق الغرفة دون كشف الأوراق السرية. لا يمكن حظر حساب إداري من اللوحة.

تعطيل الحساب يسجل النية أولًا ثم يغير Auth ويلغي توكنات التجديد؛ سجل pending يحتاج مراجعة لأن Auth وFirestore ليسا معاملة واحدة. إغلاق الغرفة وتحرير ارتباطات اللاعبين معاملة ذرية.

## cron-job.org وحدود المجانية

بعد النشر أنشئ مهمة GET إلى https://YOUR-SERVICE.onrender.com/health كل 10 دقائق، دون توكن أو جسم طلب. المتوقع HTTP 200 وstatus: ok. المسار لا يقرأ Firestore ولا يحدّث حضور اللاعبين. لا توجد مهمة cron أو خدمة منشورة تلقائيًا بمجرد نسخ الملفات.

قد تقلل المهمة نوم الخمول، لكنها لا تضمن التشغيل الدائم أو تمنع إعادة تشغيل Render أو نفاد ساعات الخطة. Render Free يوفر 750 ساعة شهريًا مشتركة لمساحة العمل. Firestore Spark له حصص قراءة وكتابة؛ polling والمعاملات تستهلكها. ابدأ بعدد صغير وراقب الحصص. لا تغير الخطة إلى Blaze.

المراجع: [Render Free](https://render.com/docs/free)، [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).

## حدود التشغيل والأمان

- الخادم يتحكم بالأوراق والأدوار والنقاط ويتحقق من هوية اللاعب وحظره. معرف العملية يمنع تكرار تنفيذ المحاولة المعادة.
- البيانات الدائمة في Firestore؛ لا يعتمد الخادم على قرص Render المؤقت. لا تسجل الطلبات أو التوكنات أو الأيدي في السجلات.
- محدد الطلبات في ذاكرة نسخة خادم واحدة، ويعاد ضبطه عند إعادة التشغيل. يلزم محدد مشترك عند التوسع لعدة نسخ.
- معالجة مهلة الدور تتم عند استطلاع الغرفة؛ إذا انقطع الجميع تستأنف عند العودة. لا يوجد مؤقت دائم لكل غرفة.
- تنظيف المنتهي كل ساعة أثناء تشغيل الخادم، حتى 100 وثيقة لكل مجموعة في الدورة، دون خدمة TTL مدفوعة. سجلات الإدارة لا تحذف تلقائيًا؛ راقب نموها.
- لا يوجد اختبار حمل إنتاجي أو ضمان ضد DDoS؛ حدود الطلبات دفاع أولي والمجانية لا تعني سعة غير محدودة.

### دخول الإدارة عبر Google

زر Google يستخدم Firebase Auth بنافذة منبثقة وجلسة مؤقتة في الذاكرة، ثم يستبدلها بجلسة الإدارة HttpOnly. لا يحتاج سر OAuth Desktop أو كلمة مرور Google داخل اللوحة. يبقى UID ضمن ADMIN_UIDS شرطًا إلزاميًا، ولا يمنح تسجيل Google صلاحية إدارة تلقائية.

فعّل Google في Firebase Authentication → Sign-in method، وأضف `tarneeb-server-kxqf.onrender.com` في Authentication → Settings → Authorized domains (دون https أو مسار). للنشر على نطاق مختلف أضف ذلك النطاق. اسمح بالنوافذ المنبثقة عند طلب المتصفح. يعتمد authDomain على FIREBASE_PROJECT_ID والنطاق الافتراضي firebaseapp.com.
