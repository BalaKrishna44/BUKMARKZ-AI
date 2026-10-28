from django.contrib import admin

from .models import (
    Category,
    Bookmark,
    Recommendation,
    HelpUser,
    EmailBookmark,
)


class CountryAdmin(admin.ModelAdmin):
    list_display = ('country', 'get_users', 'get_offers')


class BookmarkInLine(admin.TabularInline):
    model = Bookmark
    extra = 0


class CategoryAdmin(admin.ModelAdmin):
    inlines = [
        BookmarkInLine,
    ]
    list_display = ('title', 'user', 'private')
    list_filter = ('user', 'private')


class BookmarkAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'url')
    list_filter = ('category',)


class RecommendationAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'url', 'added')
    list_filter = ('user',)


class HelpUserAdmin(admin.ModelAdmin):
    list_display = ('user', 'searching', 'country', 'zip', 'price', 'checked')
    list_filter = ('user', 'checked')


class EmailBookmarkAdmin(admin.ModelAdmin):
    list_display = ('user', 'title', 'url',)
    list_filter = ('user',)


class OfferAdmin(admin.ModelAdmin):
    list_display = ('country', 'title', 'url')
    list_filter = ('country',)


admin.site.register(Category, CategoryAdmin)
admin.site.register(Bookmark, BookmarkAdmin)
admin.site.register(Recommendation, RecommendationAdmin)
admin.site.register(HelpUser, HelpUserAdmin)
admin.site.register(EmailBookmark, EmailBookmarkAdmin)
