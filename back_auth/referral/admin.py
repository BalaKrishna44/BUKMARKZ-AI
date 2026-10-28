from django.contrib import admin

from .models import Referral, RefRelation


class ReferralAdmin(admin.ModelAdmin):
    list_display = ('user', 'registrations', 'subs', 'wallet')


class RefRelationAdmin(admin.ModelAdmin):
    list_display = ('user', 'referrer')
    list_filter = ('referrer', )


admin.site.register(Referral, ReferralAdmin)
admin.site.register(RefRelation, RefRelationAdmin)
