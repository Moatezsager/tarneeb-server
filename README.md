# Tarneeb server

## Bot strategy

The Godot and server bots share the same public-information strategy: estimate remaining suits, protect their own contract, deny the leading scorer's positive bid or spoil their nil, conserve trumps when a lower scorer already blocks the leader, and retain the hearts ace to trap the queen. They use no opponent hands or private coordination. Match-ending bids take priority over temporary cooperation. Gameplay rules and protocol 3 are unchanged.

`test/bot-strategy.test.js` checks 17 tactical positions recorded by Godot, rotates them through all four seats and rejects hidden-hand reads or state mutations. Regenerate `test/fixtures/bot-strategy.json` with the sibling client's `tests/bot_strategy_test.gd`, and `rules-parity.json` with `tests/export_rules_parity.gd`, both in `TARNEEB_TEST_MODE=1`. Run `npm test` after copying their outputs from the client's `tests/artifacts/`. Publish the matching Godot web export for local browser bots; online bots run this server's engine.

خادم مستقل للعبة طرنيب: Node.js 22 وFirebase Admin SDK، يعمل على Render Free دون Cloud Functions أو ترقية Firebase إلى Blaze. يشمل منطق اللعب والملفات الشخصية والأصدقاء والدعوات والغرف ولوحة إدارة عربية.

## التشغيل والاختبار

```sh
npm ci
# انسخ .env.example إلى .env واضبط القيم ثم:
node --env-file=.env server.js
npm test
# يتطلب Firebase CLI وJava:
firebase emulators:exec --config firebase.test.json --project demo-tarneeb-secure --only "firestore,auth" "npm test"
```

لا يحتاج البناء أو الاختبار إلى Godot أو مشروع TypeScript. fixtures توافق Godot محفوظة داخل test/fixtures. npm test يتخطى اختبارات قاعدة البيانات خارج المحاكي؛ الأمر الأخير يشغلها جميعًا على بيانات مؤقتة، وليس الإنتاج.

## النشر على Render Free

1. اربط هذا المستودع بخدمة Web Service مجانية أو استورد render.yaml كـ Blueprint. اترك Root Directory فارغًا. البناء `npm ci --omit=dev` والتشغيل `npm start`.
2. اضبط PUBLIC_ORIGIN على عنوان الخدمة HTTPS دون مسار مثل /online أو /admin. يقبل الخادم الشرطة النهائية والمسافات المحيطة ويزيلها تلقائيًا.
3. اضبط FIREBASE_PROJECT_ID وFIRESTORE_DATABASE_ID وFIREBASE_WEB_API_KEY حسب مشروع Firebase. معرفات المشروع الحالي موجودة في .env.example.
4. ضع Firebase Authentication UID الخاص بالمسؤول في ADMIN_UIDS؛ يمكن فصل عدة معرفات بفواصل. الاسم والبريد لا يمنحان صلاحيات الإدارة.
5. أضف حساب خدمة مخصصًا كـ Render Secret File باسم firebase-service-account.json. GOOGLE_APPLICATION_CREDENTIALS مضبوط على /etc/secrets/firebase-service-account.json. يحتاج حساب الخدمة إلى قراءة بيانات Firestore وكتابتها وحذفها، وإلى صلاحيات إدارة المستخدمين في Firebase Authentication بما فيها `firebaseauth.users.delete`. [صلاحيات Firestore](https://docs.cloud.google.com/firestore/native/docs/security/iam) و[صلاحيات Firebase Authentication](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).
6. لا ترفع ملف حساب الخدمة أو .env إلى Git أو Godot. ضع الأسرار في إعدادات Render فقط.
7. بعد اختبار الخادم انشر القواعد والفهارس من هذا المستودع:

```sh
firebase deploy --only firestore --project gen-lang-client-0141680917
```

انتظر جاهزية الفهارس. القواعد تمنع الكتابة المباشرة من العملاء؛ نسق نشرها مع تحديث اللعبة لأن العميل القديم غير متوافق. إعداد النشر لا يتضمن Cloud Functions أو موارد مدفوعة.

## ربط Godot

قواعد اللعب الفردي تستخدم البروتوكول 3. انشر خادم Render ونسخة الويب من إصدار القواعد نفسه بعد انتهاء مباريات البروتوكول 2، وحدّث نسخ الهاتف والكمبيوتر قبل دخولها مجددًا إلى الأونلاين. نسخة أقدم ستتلقى رسالة تطلب التحديث.

اضبط SERVER_URL في scripts/firebase_config.gd على أصل HTTPS نفسه دون /online. يمكن استخدام متغير البيئة TARNEEB_SERVER_URL أثناء التطوير. ترسل اللعبة Firebase ID token إلى /online؛ UID مستخرج من التوكن المتحقق منه. مهلة طلب اللعب 75 ثانية لكل محاولة لاستيعاب إيقاظ Render دون حجب الواجهة.

## لوحة الإدارة

افتح /admin. استخدم زر Google أو حساب Firebase Email/Password؛ يجب أن يكون UID الحساب ضمن ADMIN_UIDS. فعّل مزود الدخول المطلوب في Firebase. تسجيل الدخول عبر Google لا يحتاج إعداد كلمة مرور للوحة.

الجلسة Cookie لمدة 8 ساعات، HttpOnly وSecure وSameSite=Strict في الإنتاج. يتحقق الخادم من إلغاء الجلسات والحظر وأصل طلبات الإدارة. تعرض اللوحة أرصدة الذهب وحالة الحسابات والغرف وآخر دورة صيانة. تُسجّل إضافة الذهب بالرصيد قبل الإضافة وبعدها، ويمنع معرّف الإجراء احتساب المحاولة المعادة مرتين.

يتطلب حذف الحساب كتابة UID في نافذة التأكيد. يتابع الخادم الحذف من Authentication وFirestore عبر مهمة محفوظة تُعاد عند التعثر. يشمل الحذف الملف ومجموعاته الفرعية والرصيد والإحصاءات وحجز المعرف والعلاقات والدعوات والمقاعد المرتبطة. يحفظ سجل الإدارة معرّف الهدف وحالة الإجراء. حسابات المسؤولين محمية من الحظر والحذف.

يحذف إغلاق الغرفة إداريًا أو خروج آخر لاعب وثيقة الغرفة وحالة اللعب والارتباطات مباشرة. عند الفوز يثبت الخادم المكافآت ويحذف الغرفة في المعاملة نفسها. يبقى ملخص النتيجة متاحًا لأعضائها خمس دقائق.

## cron-job.org وحدود المجانية

بعد النشر أنشئ مهمة GET إلى https://YOUR-SERVICE.onrender.com/health كل 10 دقائق، دون توكن أو جسم طلب. المتوقع HTTP 200 وstatus: ok. المسار لا يقرأ Firestore ولا يحدّث حضور اللاعبين. لا توجد مهمة cron أو خدمة منشورة تلقائيًا بمجرد نسخ الملفات.

قد تقلل المهمة نوم الخمول، لكنها لا تضمن التشغيل الدائم أو تمنع إعادة تشغيل Render أو نفاد ساعات الخطة. Render Free يوفر 750 ساعة شهريًا مشتركة لمساحة العمل. Firestore Spark له حصص قراءة وكتابة؛ polling والمعاملات تستهلكها. ابدأ بعدد صغير وراقب الحصص. لا تغير الخطة إلى Blaze.

المراجع: [Render Free](https://render.com/docs/free)، [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).

## حدود التشغيل والأمان

يحتفظ مستند `users/{uid}` بملف اللاعب ورصيده ومقتنياته وإحصاءاته، وبقائمة أصدقائه حتى 250 صديقًا. يُنقل الرصيد القديم داخل معاملة عند قراءة الحساب أو تعديله لأول مرة، وتُنقل قائمة الأصدقاء عند فتحها. تُحذف مستندات المصدر بعد نجاح النقل. تبقى قوائم الأصدقاء القديمة التي تتجاوز الحد في مجموعاتها الفرعية.

يستقبل اللاعب المتصل إشعارات الصداقة والدعوات عبر طلب انتظار محدود على خادم Render دون قراءة دورية من Firestore. يخزّن الخادم التنبيهات الحديثة مؤقتًا في ذاكرة النسخة الواحدة. تبقى الطلبات المعلقة قابلة للعرض بعد إعادة الاتصال، ويُحذف المستند بعد قبول الطلب أو رفضه أو إلغائه.

يستعمل الخادم لقطة Firestore مشتركة بين طلبات الغرفة لمدة تصل إلى خمس ثوانٍ. تُستبعد اللقطة عند تعديل الغرفة، وتظل الحركات والتحقق من الدور على معاملات Firestore. تبقى حالة اللعب الخاصة في مستند محمي، ويُرسل الخادم لكل لاعب أوراقه فقط. ملفات رسوم الأوراق ضمن حزمة اللعبة.

يتوقف عميل Godot عن الاستعلام عند استلام النتيجة النهائية أو مغادرة الغرفة. تُفحص الغرف المتروكة وطلبات حذف الحسابات كل دقيقتين. تُفحص بقية السجلات المنتهية كل 15 دقيقة تقريبًا، ويُستأنف فحصها في الدورة التالية إذا امتلأت صفحة التنظيف.

- الخادم يتحكم بالأوراق والأدوار والنقاط ويتحقق من هوية اللاعب وحظره. معرف العملية يمنع تكرار تنفيذ المحاولة المعادة.
- البيانات الدائمة في Firestore؛ لا يعتمد الخادم على قرص Render المؤقت. لا تسجل الطلبات أو التوكنات أو الأيدي في السجلات.
- محدد الطلبات في ذاكرة نسخة خادم واحدة، ويعاد ضبطه عند إعادة التشغيل. يلزم محدد مشترك عند التوسع لعدة نسخ.
- تعالج مهلة الدور عند استطلاع الغرفة. تدخل الغرف التي انقطع نشاطها ثلاث دقائق في دورة التنظيف التالية.
- يبدأ التنظيف عند تشغيل الخادم ويتكرر كل دقيقتين وهو مستيقظ. تزيل الدورات السجلات المنتهية على دفعات محدودة وتستأنف مهام حذف الحسابات. تفحص دورة منفصلة مؤشرات الغرف اليتيمة كل 15 دقيقة. تبقى سجلات الإدارة محفوظة.
- لا يوجد اختبار حمل إنتاجي أو ضمان ضد DDoS؛ حدود الطلبات دفاع أولي والمجانية لا تعني سعة غير محدودة.

### دخول الإدارة عبر Google

زر Google يستخدم Firebase Auth بنافذة منبثقة وجلسة مؤقتة في الذاكرة، ثم يستبدلها بجلسة الإدارة HttpOnly. لا يحتاج سر OAuth Desktop أو كلمة مرور Google داخل اللوحة. يبقى UID ضمن ADMIN_UIDS شرطًا إلزاميًا، ولا يمنح تسجيل Google صلاحية إدارة تلقائية.

فعّل Google في Firebase Authentication → Sign-in method، وأضف `tarneeb-server-kxqf.onrender.com` في Authentication → Settings → Authorized domains (دون https أو مسار). للنشر على نطاق مختلف أضف ذلك النطاق. اسمح بالنوافذ المنبثقة عند طلب المتصفح. يعتمد authDomain على FIREBASE_PROJECT_ID والنطاق الافتراضي firebaseapp.com.

## Profile completion

Profile edits validate a 3–24 character Arabic/Unicode letter-and-number name (spaces, underscore and hyphen allowed), integer age 1–120, male/female gender, a supported country code and avatar_1 through avatar_12. `complete:true` requires every field. These bounds validate input; they are not a verified age or age eligibility policy. Email uniqueness and account authentication remain Firebase Authentication responsibilities.

The profile response to its owner includes age and profileComplete; search and friends omit age. Legacy profiles keep their UID/searchId and are prompted by the new Godot client to complete missing data. New room creation/join requires a complete profile; existing room members may resume or leave. The application-default initial profile remains incomplete until explicitly saved. Ship the matching Godot client alongside this server change.
