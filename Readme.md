# 起動方法
## 以下のコマンドでサーバー起動
cd "C:\Users\中村　魁斗\OneDrive\Desktop\Expenses\app"
npx nodemon server.js
## 以下のURLにアクセス
http://localhost:3000/


# DBへの反映（マイグレーション）
npx prisma generate    # Prisma Client の生成
npx prisma migrate dev # マイグレーション


## トラブったとき(DBから取得)
npx prisma db pull

## プッシュ
npx prisma db push

## 変更適用
npx prisma generate
